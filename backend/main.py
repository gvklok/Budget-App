from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, get_db, SessionLocal
from routers import funds, expenses, transactions, transfers, checklist, overview, dev, monthly_reserve, income

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
app.include_router(transactions.router, prefix="/transactions", tags=["transactions"])
app.include_router(transfers.router, prefix="/transfers", tags=["transfers"])
app.include_router(checklist.router, prefix="/checklist", tags=["checklist"])
app.include_router(overview.router, prefix="/overview", tags=["overview"])
app.include_router(dev.router, prefix="/dev", tags=["dev"])
app.include_router(monthly_reserve.router, prefix="/monthly-reserve", tags=["monthly-reserve"])
app.include_router(income.router, tags=["income"])


def _migrate() -> None:
    with engine.connect() as conn:
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
        conn.commit()


def _seed(db: Session) -> None:
    if not db.query(models.RealCash).first():
        db.add(models.RealCash(id=1, balance_cents=0))
    if not db.query(models.Savings).first():
        db.add(models.Savings(id=1, balance_cents=0))
    if not db.query(models.MonthlyReserve).first():
        db.add(models.MonthlyReserve(id=1, balance_cents=0, target_cents=0))
    db.commit()


@app.on_event("startup")
def startup() -> None:
    _migrate()
    with SessionLocal() as db:
        _seed(db)


@app.get("/health")
def health():
    return {"status": "ok"}


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
