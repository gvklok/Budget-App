from datetime import date

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

import models
import schemas
import plans as plans_lib
from database import engine, get_db, SessionLocal
from routers import funds, expenses, transactions, transfers, checklist, overview, dev, monthly_reserve, income, plans, ledger_read, export

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Budget App API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(funds.router, prefix="/funds", tags=["funds"])
app.include_router(expenses.router, prefix="/line-items", tags=["line-items"])
app.include_router(transactions.router, prefix="/transactions", tags=["transactions"])  # Gate 12
app.include_router(transfers.router, prefix="/transfers", tags=["transfers"])
app.include_router(checklist.router, prefix="/checklist", tags=["checklist"])
app.include_router(overview.router, prefix="/overview", tags=["overview"])
app.include_router(dev.router, prefix="/dev", tags=["dev"])
app.include_router(monthly_reserve.router, prefix="/monthly-reserve", tags=["monthly-reserve"])
app.include_router(income.router, tags=["income"])
app.include_router(plans.router, prefix="/plans", tags=["plans"])  # U3
app.include_router(ledger_read.router, prefix="/ledger", tags=["ledger"])
app.include_router(export.router, tags=["export"])


def _migrate() -> None:
    with engine.connect() as conn:
        # funds table additions (U1, U9)
        fund_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(funds)"))}
        if "destination_type" not in fund_cols:
            conn.execute(text("ALTER TABLE funds ADD COLUMN destination_type TEXT NOT NULL DEFAULT 'external_spend'"))
        if "allow_negative_balance" not in fund_cols:
            conn.execute(text("ALTER TABLE funds ADD COLUMN allow_negative_balance BOOLEAN NOT NULL DEFAULT 0"))
        if "sort_order" not in fund_cols:
            conn.execute(text("ALTER TABLE funds ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
            # New column defaults every existing row to 0 — backfill so current
            # (id) order is preserved instead of collapsing to a single tie.
            conn.execute(text("UPDATE funds SET sort_order = id WHERE sort_order = 0"))
        if "color" not in fund_cols:
            conn.execute(text("ALTER TABLE funds ADD COLUMN color TEXT"))
        if "goal_cents" not in fund_cols:
            conn.execute(text("ALTER TABLE funds ADD COLUMN goal_cents INTEGER"))

        # monthly_plans table additions (U6)
        plan_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(monthly_plans)"))}
        if "top_off_executed_at" not in plan_cols:
            conn.execute(text("ALTER TABLE monthly_plans ADD COLUMN top_off_executed_at DATETIME"))
        if "distribute_executed_at" not in plan_cols:
            conn.execute(text("ALTER TABLE monthly_plans ADD COLUMN distribute_executed_at DATETIME"))

        # simulated_transactions table additions (U1)
        sim_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(simulated_transactions)"))}
        if "destination_type" not in sim_cols:
            conn.execute(text("ALTER TABLE simulated_transactions ADD COLUMN destination_type TEXT NOT NULL DEFAULT 'external_spend'"))

        # expenses table additions
        existing = {row[1] for row in conn.execute(text("PRAGMA table_info(expenses)"))}
        if "actual_cents" not in existing:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN actual_cents INTEGER NOT NULL DEFAULT 0"))
        if "category_id" not in existing:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN category_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL"))
        if "type" not in existing:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN type TEXT NOT NULL DEFAULT 'bill'"))
        if "fund_id" not in existing:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL"))
        if "sort_order" not in existing:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
            conn.commit()
            # New column defaults every existing row to 0 — backfill so current
            # (id) order is preserved instead of collapsing to a single tie.
            conn.execute(text("UPDATE expenses SET sort_order = id WHERE sort_order = 0"))
        if "plan_id" not in existing:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN plan_id INTEGER REFERENCES monthly_plans(id) ON DELETE CASCADE"))
            conn.commit()
            # Backfill (U3): any pre-existing line items didn't belong to a month
            # yet — assign them to the real current month's plan so they don't
            # silently vanish from the now-month-scoped Expenses page.
            today = date.today()
            existing_plan = conn.execute(
                text("SELECT id FROM monthly_plans WHERE year = :y AND month = :m"),
                {"y": today.year, "m": today.month},
            ).first()
            if existing_plan:
                plan_id = existing_plan[0]
            else:
                result = conn.execute(
                    text("INSERT INTO monthly_plans (year, month) VALUES (:y, :m)"),
                    {"y": today.year, "m": today.month},
                )
                plan_id = result.lastrowid
            conn.execute(
                text("UPDATE expenses SET plan_id = :p WHERE plan_id IS NULL"),
                {"p": plan_id},
            )
        if "color" not in existing:
            conn.execute(text("ALTER TABLE expenses ADD COLUMN color TEXT"))

        # transactions table: line_item_id must be ON DELETE SET NULL (owner
        # ruling — deletion never destroys history). Rebuild only when the live
        # FK action is wrong (legacy CASCADE) or the table predates fund_id;
        # inspect the actual on_delete via PRAGMA so hot-reloads are idempotent.
        tx_cols = {row[1]: row for row in conn.execute(text("PRAGMA table_info(transactions)"))}
        fk_rows = conn.execute(text("PRAGMA foreign_key_list(transactions)")).fetchall()
        # PRAGMA foreign_key_list columns: (id, seq, table, from, to, on_update, on_delete, match)
        line_item_on_delete = next((fk[6] for fk in fk_rows if fk[3] == "line_item_id"), None)
        needs_rebuild = (
            ("line_item_id" in tx_cols and tx_cols["line_item_id"][3] == 1)  # notnull=1 legacy
            or "fund_id" not in tx_cols
            or (line_item_on_delete is not None and line_item_on_delete != "SET NULL")
        )
        if needs_rebuild:
            conn.execute(text("DROP TABLE IF EXISTS transactions_new"))
            conn.execute(text("""
                CREATE TABLE transactions_new (
                    id INTEGER PRIMARY KEY,
                    amount_cents INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    merchant TEXT,
                    line_item_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
                    fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL,
                    created_at DATETIME,
                    source TEXT NOT NULL DEFAULT 'manual',
                    external_id TEXT,
                    status TEXT NOT NULL DEFAULT 'posted',
                    line_item_name TEXT,
                    destination_type TEXT
                )
            """))
            # Preserve EVERY column. Sanitize dangling line_item_id/fund_id (legacy
            # orphans left behind while FK enforcement was OFF) to NULL so the copy
            # satisfies the now-enforced constraints instead of aborting startup.
            src = "t.source" if "source" in tx_cols else "'manual'"
            ext = "t.external_id" if "external_id" in tx_cols else "NULL"
            sta = "t.status" if "status" in tx_cols else "'posted'"
            nam = "t.line_item_name" if "line_item_name" in tx_cols else "NULL"
            dst = "t.destination_type" if "destination_type" in tx_cols else "NULL"
            conn.execute(text(f"""
                INSERT INTO transactions_new
                    (id, amount_cents, date, merchant, line_item_id, fund_id, created_at,
                     source, external_id, status, line_item_name, destination_type)
                SELECT t.id, t.amount_cents, t.date, t.merchant,
                       CASE WHEN e.id IS NULL THEN NULL ELSE t.line_item_id END,
                       CASE WHEN f.id IS NULL THEN NULL ELSE t.fund_id END,
                       t.created_at, {src}, {ext}, {sta}, {nam}, {dst}
                FROM transactions t
                LEFT JOIN expenses e ON e.id = t.line_item_id
                LEFT JOIN funds f ON f.id = t.fund_id
            """))
            conn.execute(text("DROP TABLE transactions"))
            conn.execute(text("ALTER TABLE transactions_new RENAME TO transactions"))

        # Ensure seam + snapshot columns exist (covers the no-rebuild path). Re-read
        # cols in case the table was just rebuilt above.
        tx_cols2 = {row[1] for row in conn.execute(text("PRAGMA table_info(transactions)"))}
        if "source" not in tx_cols2:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'"))
        if "external_id" not in tx_cols2:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN external_id TEXT"))
        if "status" not in tx_cols2:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'posted'"))
        if "line_item_name" not in tx_cols2:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN line_item_name TEXT"))
        if "destination_type" not in tx_cols2:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN destination_type TEXT"))
        # Partial unique index: dedupe imported rows, leave manual (NULL) rows free.
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_transactions_source_external_id "
            "ON transactions (source, external_id) WHERE external_id IS NOT NULL"
        ))

        # Backfill name snapshots for rows whose line item still resolves (one-time;
        # idempotent since it only fills NULLs). Orphans that already lost their
        # line item stay NULL and report as "Deleted bill".
        conn.execute(text("""
            UPDATE transactions SET line_item_name = (
                SELECT e.name FROM expenses e WHERE e.id = transactions.line_item_id
            )
            WHERE line_item_id IS NOT NULL AND line_item_name IS NULL
        """))
        # Backfill destination snapshot from the fund's CURRENT destination — best
        # available for pre-snapshot rows (direct fund spends, then fund line items).
        conn.execute(text("""
            UPDATE transactions SET destination_type = (
                SELECT f.destination_type FROM funds f WHERE f.id = transactions.fund_id
            )
            WHERE fund_id IS NOT NULL AND destination_type IS NULL
              AND EXISTS (SELECT 1 FROM funds f WHERE f.id = transactions.fund_id)
        """))
        conn.execute(text("""
            UPDATE transactions SET destination_type = (
                SELECT f.destination_type FROM funds f
                JOIN expenses e ON e.fund_id = f.id
                WHERE e.id = transactions.line_item_id AND e.type = 'fund'
            )
            WHERE line_item_id IS NOT NULL AND destination_type IS NULL
              AND EXISTS (
                SELECT 1 FROM expenses e JOIN funds f ON f.id = e.fund_id
                WHERE e.id = transactions.line_item_id AND e.type = 'fund'
              )
        """))

        # ledger_entries destination snapshot (U-ledger). Backfill fund-side spends
        # and their reversals from the fund's current destination.
        led_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(ledger_entries)"))}
        if "destination_type" not in led_cols:
            conn.execute(text("ALTER TABLE ledger_entries ADD COLUMN destination_type TEXT"))
        conn.execute(text("""
            UPDATE ledger_entries SET destination_type = (
                SELECT f.destination_type FROM funds f
                WHERE 'fund:' || f.id = ledger_entries.from_bucket
            )
            WHERE kind = 'spend' AND destination_type IS NULL AND from_bucket LIKE 'fund:%'
              AND EXISTS (SELECT 1 FROM funds f WHERE 'fund:' || f.id = ledger_entries.from_bucket)
        """))
        conn.execute(text("""
            UPDATE ledger_entries SET destination_type = (
                SELECT f.destination_type FROM funds f
                WHERE 'fund:' || f.id = ledger_entries.to_bucket
            )
            WHERE kind = 'spend_reversal' AND destination_type IS NULL AND to_bucket LIKE 'fund:%'
              AND EXISTS (SELECT 1 FROM funds f WHERE 'fund:' || f.id = ledger_entries.to_bucket)
        """))
        conn.commit()


def _seed(db: Session) -> None:
    if not db.query(models.RealCash).first():
        db.add(models.RealCash(id=1, balance_cents=0))
    if not db.query(models.Savings).first():
        db.add(models.Savings(id=1, balance_cents=0))
    if not db.query(models.MonthlyReserve).first():
        db.add(models.MonthlyReserve(id=1, balance_cents=0, target_cents=0))
    if not db.query(models.AppClock).first():
        db.add(models.AppClock(id=1, simulated_date=None))
    db.commit()


@app.on_event("startup")
def startup() -> None:
    _migrate()
    with SessionLocal() as db:
        _seed(db)
        plans_lib.sync_mr_target(db)
        db.commit()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/current-month-status")
def current_month_status(db: Session = Depends(get_db)):
    """U6: whether top-off/distribute have been run for the effective current
    month — drives the new-month banner. Never about whichever month is being
    viewed on the Expenses page, only the real (or simulated) current month."""
    year, month = plans_lib.current_year_month(db)
    # Runs on every app open (banner check). Lazily materialize the effective
    # current month's plan here so a fresh month is created + its MR target
    # synced on first load — the banner status and target must never be stale.
    plan = plans_lib.get_or_autoload_plan(db, year, month)
    top_off_done = bool(plan and plan.top_off_executed_at)
    distribute_done = bool(plan and plan.distribute_executed_at)
    return {
        "year": year,
        "month": month,
        "top_off_done": top_off_done,
        "distribute_done": distribute_done,
        "needs_banner": not (top_off_done and distribute_done),
    }


@app.get("/state", response_model=schemas.StateOut)
def get_state(db: Session = Depends(get_db)):
    real_cash = db.query(models.RealCash).first()
    savings = db.query(models.Savings).first()
    mr = db.query(models.MonthlyReserve).first()
    all_funds = db.query(models.Fund).order_by(models.Fund.sort_order, models.Fund.id).all()

    fund_total = sum(f.balance_cents for f in all_funds)
    invariant_holds = (
        real_cash.balance_cents
        == savings.balance_cents + mr.balance_cents + fund_total
    )

    return schemas.StateOut(
        real_cash=schemas.RealCashOut.model_validate(real_cash),
        savings=schemas.SavingsOut.model_validate(savings),
        monthly_reserve=schemas.MonthlyReserveOut.model_validate(mr),
        funds=[schemas.FundOut.model_validate(f) for f in all_funds],
        invariant_holds=invariant_holds,
    )
