from datetime import date

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

import models
import schemas
import plans as plans_lib
from database import engine, get_db, SessionLocal
from routers import funds, expenses, transactions, transfers, checklist, overview, dev, monthly_reserve, income, plans, ledger_read

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


def _migrate() -> None:
    with engine.connect() as conn:
        # funds table additions (U1, U9)
        fund_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(funds)"))}
        if "destination_type" not in fund_cols:
            conn.execute(text("ALTER TABLE funds ADD COLUMN destination_type TEXT NOT NULL DEFAULT 'external_spend'"))
        if "allow_negative_balance" not in fund_cols:
            conn.execute(text("ALTER TABLE funds ADD COLUMN allow_negative_balance BOOLEAN NOT NULL DEFAULT 0"))

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

        # transactions table: make line_item_id nullable + add fund_id
        tx_cols = {row[1]: row for row in conn.execute(text("PRAGMA table_info(transactions)"))}
        needs_rebuild = (
            "line_item_id" in tx_cols and tx_cols["line_item_id"][3] == 1  # notnull=1
        ) or "fund_id" not in tx_cols
        if needs_rebuild:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS transactions_new (
                    id INTEGER PRIMARY KEY,
                    amount_cents INTEGER NOT NULL,
                    date TEXT NOT NULL,
                    merchant TEXT,
                    line_item_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
                    fund_id INTEGER REFERENCES funds(id) ON DELETE SET NULL,
                    created_at DATETIME
                )
            """))
            conn.execute(text("""
                INSERT INTO transactions_new (id, amount_cents, date, merchant, line_item_id, created_at)
                SELECT id, amount_cents, date, merchant, line_item_id, created_at FROM transactions
            """))
            conn.execute(text("DROP TABLE transactions"))
            conn.execute(text("ALTER TABLE transactions_new RENAME TO transactions"))
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
    plan = plans_lib.get_plan(db, year, month)
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
    all_funds = db.query(models.Fund).order_by(models.Fund.id).all()

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
