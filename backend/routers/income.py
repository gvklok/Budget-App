from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
import plans as plans_lib
from database import get_db

router = APIRouter()

VALID_FREQUENCIES = {"monthly", "semimonthly", "biweekly", "weekly"}
MULTIPLIERS = {"monthly": 1, "semimonthly": 2, "biweekly": 26 / 12, "weekly": 52 / 12}


def _monthly_cents(source: models.IncomeSource) -> int:
    return round(source.amount_cents * MULTIPLIERS[source.frequency])


# ── Income sources CRUD ───────────────────────────────────────────────────────

@router.get("/income-sources", response_model=list[schemas.IncomeSourceOut])
def list_income_sources(db: Session = Depends(get_db)):
    return db.query(models.IncomeSource).order_by(models.IncomeSource.id).all()


@router.post("/income-sources", response_model=schemas.IncomeSourceOut)
def create_income_source(body: schemas.IncomeSourceCreate, db: Session = Depends(get_db)):
    if body.frequency not in VALID_FREQUENCIES:
        raise HTTPException(400, f"frequency must be one of {sorted(VALID_FREQUENCIES)}")
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")
    source = models.IncomeSource(name=body.name, amount_cents=body.amount_cents, frequency=body.frequency)
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@router.patch("/income-sources/{source_id}", response_model=schemas.IncomeSourceOut)
def update_income_source(source_id: int, body: schemas.IncomeSourceUpdate, db: Session = Depends(get_db)):
    source = db.query(models.IncomeSource).filter(models.IncomeSource.id == source_id).first()
    if not source:
        raise HTTPException(404, "Income source not found")
    if body.name is not None:
        source.name = body.name
    if body.amount_cents is not None:
        if body.amount_cents <= 0:
            raise HTTPException(400, "Amount must be positive")
        source.amount_cents = body.amount_cents
    if body.frequency is not None:
        if body.frequency not in VALID_FREQUENCIES:
            raise HTTPException(400, f"frequency must be one of {sorted(VALID_FREQUENCIES)}")
        source.frequency = body.frequency
    db.commit()
    db.refresh(source)
    return source


@router.delete("/income-sources/{source_id}")
def delete_income_source(source_id: int, db: Session = Depends(get_db)):
    source = db.query(models.IncomeSource).filter(models.IncomeSource.id == source_id).first()
    if not source:
        raise HTTPException(404, "Income source not found")
    db.delete(source)
    db.commit()
    return {"ok": True}


# ── Monthly summary ───────────────────────────────────────────────────────────
# U3: bills come from the requested (or effective-current, if omitted) month's
# plan. Funds stay month-agnostic — this app's Fund contributions are a global
# property of the Fund itself, not a per-month line item (see U3 notes).

@router.get("/monthly-summary")
def monthly_summary(year: Optional[int] = None, month: Optional[int] = None, db: Session = Depends(get_db)):
    if year is None or month is None:
        year, month = plans_lib.current_year_month(db)

    sources = db.query(models.IncomeSource).all()
    plan = plans_lib.get_plan(db, year, month)
    bills = (
        db.query(models.Expense).filter(models.Expense.plan_id == plan.id, models.Expense.type == "bill").all()
        if plan else []
    )
    funds = db.query(models.Fund).all()
    fund_by_id = {f.id: f for f in funds}

    expected_income = sum(_monthly_cents(s) for s in sources)

    bills_total = sum(e.amount_cents for e in bills)
    fund_total = sum(f.monthly_contribution_cents for f in funds)
    expenses_total = bills_total + fund_total

    # Actual spending in the requested month (U1 + U3): transfer-out Fund
    # transactions don't count as spending — they moved to another account you
    # own, not out of your net worth.
    bill_line_item_ids = {e.id for e in bills}
    month_prefix = f"{year:04d}-{month:02d}"
    month_txns = db.query(models.Transaction).filter(models.Transaction.date.like(f"{month_prefix}%")).all()
    actual_bills_spent = 0
    actual_fund_spent = 0
    transfers_out_cents = 0

    for tx in month_txns:
        if tx.line_item_id is not None and tx.line_item_id in bill_line_item_ids:
            actual_bills_spent += tx.amount_cents
            continue
        # Resolve the Fund this transaction hits: either a direct fund spend, or
        # a fund line-item transaction (bug 5: the latter was previously counted
        # in neither spending nor transfers-out — resolve its linked fund and
        # treat it exactly like a direct fund_id transaction).
        fund = None
        if tx.fund_id is not None:
            fund = fund_by_id.get(tx.fund_id)
        elif tx.line_item_id is not None:
            line_item = db.query(models.Expense).filter(models.Expense.id == tx.line_item_id).first()
            if line_item is not None and line_item.type == "fund" and line_item.fund_id:
                fund = fund_by_id.get(line_item.fund_id)
        # Only a positively-resolved transfer_out fund escapes "spending".
        # Orphaned spends (deleted bill / deleted fund) count as spending with
        # external_spend semantics — matching /overview/monthly's deleted-fund
        # fallback so the three reporting surfaces agree on the total.
        if fund is not None and fund.destination_type == "transfer_out":
            transfers_out_cents += tx.amount_cents
        else:
            actual_fund_spent += tx.amount_cents

    return {
        "year": year,
        "month": month,
        "expected_income_cents": expected_income,
        "expected_bills_total_cents": bills_total,
        "expected_fund_contributions_total_cents": fund_total,
        "expected_expenses_total_cents": expenses_total,
        "expected_savings_cents": expected_income - expenses_total,
        "actual_spending_cents": actual_bills_spent + actual_fund_spent,
        "transfers_out_cents": transfers_out_cents,
    }
