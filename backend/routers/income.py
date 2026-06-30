from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter()

VALID_FREQUENCIES = {"monthly", "semimonthly", "biweekly", "weekly"}

MULTIPLIERS = {
    "monthly": 1,
    "semimonthly": 2,
    "biweekly": 26 / 12,
    "weekly": 52 / 12,
}


def monthly_cents(source: models.IncomeSource) -> int:
    return round(source.amount_cents * MULTIPLIERS[source.frequency])


@router.get("/", response_model=list[schemas.IncomeSourceOut])
def list_income(db: Session = Depends(get_db)):
    return db.query(models.IncomeSource).order_by(models.IncomeSource.id).all()


@router.post("/", response_model=schemas.IncomeSourceOut)
def create_income(body: schemas.IncomeSourceCreate, db: Session = Depends(get_db)):
    if body.frequency not in VALID_FREQUENCIES:
        raise HTTPException(400, f"frequency must be one of {sorted(VALID_FREQUENCIES)}")
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")
    source = models.IncomeSource(
        name=body.name, amount_cents=body.amount_cents, frequency=body.frequency
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@router.patch("/{source_id}", response_model=schemas.IncomeSourceOut)
def update_income(source_id: int, body: schemas.IncomeSourceUpdate, db: Session = Depends(get_db)):
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


@router.delete("/{source_id}")
def delete_income(source_id: int, db: Session = Depends(get_db)):
    source = db.query(models.IncomeSource).filter(models.IncomeSource.id == source_id).first()
    if not source:
        raise HTTPException(404, "Income source not found")
    db.delete(source)
    db.commit()
    return {"ok": True}


@router.get("/projection")
def projection(db: Session = Depends(get_db)):
    sources = db.query(models.IncomeSource).all()
    funds = db.query(models.Fund).all()
    expenses = db.query(models.Expense).order_by(models.Expense.id).all()

    income_items = [
        {"id": s.id, "name": s.name, "monthly_cents": monthly_cents(s)}
        for s in sources
    ]
    total_income = sum(i["monthly_cents"] for i in income_items)

    bill_items = [
        {"id": e.id, "name": e.name, "monthly_cents": e.amount_cents}
        for e in expenses
    ]
    total_bills = sum(i["monthly_cents"] for i in bill_items)

    fund_items = [
        {"id": f.id, "name": f.name, "monthly_cents": f.monthly_contribution_cents}
        for f in funds
        if f.monthly_contribution_cents > 0
    ]
    total_fund_contributions = sum(i["monthly_cents"] for i in fund_items)

    total_outflows = total_bills + total_fund_contributions

    return {
        "income_items": income_items,
        "total_income_cents": total_income,
        "bill_items": bill_items,
        "total_bills_cents": total_bills,
        "fund_items": fund_items,
        "total_outflows_cents": total_outflows,
        "net_cents": total_income - total_outflows,
    }
