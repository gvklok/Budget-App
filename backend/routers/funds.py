from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
import plans as plans_lib
from database import get_db

router = APIRouter()

VALID_DESTINATION_TYPES = {"external_spend", "transfer_out"}


@router.get("/", response_model=list[schemas.FundOut])
def list_funds(db: Session = Depends(get_db)):
    return db.query(models.Fund).order_by(models.Fund.id).all()


@router.post("/", response_model=schemas.FundOut)
def create_fund(body: schemas.FundCreate, db: Session = Depends(get_db)):
    if body.destination_type not in VALID_DESTINATION_TYPES:
        raise HTTPException(400, f"destination_type must be one of {sorted(VALID_DESTINATION_TYPES)}")
    if body.balance_cents > 0:
        savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
        if savings.balance_cents < body.balance_cents:
            raise HTTPException(400, "Insufficient savings to fund initial balance")
        savings.balance_cents -= body.balance_cents

    fund = models.Fund(
        name=body.name,
        balance_cents=body.balance_cents,
        monthly_contribution_cents=body.monthly_contribution_cents,
        destination_type=body.destination_type,
        allow_negative_balance=body.allow_negative_balance,
    )
    db.add(fund)
    db.commit()
    db.refresh(fund)
    return fund


@router.patch("/{fund_id}", response_model=schemas.FundOut)
def update_fund(fund_id: int, body: schemas.FundUpdate, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    if body.name is not None:
        fund.name = body.name
    if body.monthly_contribution_cents is not None:
        fund.monthly_contribution_cents = body.monthly_contribution_cents
    if body.destination_type is not None:
        if body.destination_type not in VALID_DESTINATION_TYPES:
            raise HTTPException(400, f"destination_type must be one of {sorted(VALID_DESTINATION_TYPES)}")
        fund.destination_type = body.destination_type
    if body.allow_negative_balance is not None:
        # U9: switching true->false while already negative is allowed — the
        # existing negative balance persists; only NEW transactions immediately
        # start following the strict (no-further-negative) rule.
        fund.allow_negative_balance = body.allow_negative_balance
    db.commit()
    db.refresh(fund)
    return fund


def _mark_distribute_executed(db: Session) -> None:
    """U6: record that distribute ran for the current month, so the new-month
    banner stops nagging — marked whenever the action was attempted, funded or
    partially skipped alike."""
    year, month = plans_lib.current_year_month(db)
    plan = plans_lib.get_or_create_plan(db, year, month)
    plan.distribute_executed_at = datetime.utcnow()
    db.commit()


@router.post("/distribute")
def distribute(db: Session = Depends(get_db)):
    funds = db.query(models.Fund).filter(models.Fund.monthly_contribution_cents > 0).order_by(models.Fund.id).all()
    if not funds:
        _mark_distribute_executed(db)
        raise HTTPException(400, "No funds have a monthly contribution set")

    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    funded = []
    skipped = []

    for fund in funds:
        if savings.balance_cents >= fund.monthly_contribution_cents:
            fund.balance_cents += fund.monthly_contribution_cents
            savings.balance_cents -= fund.monthly_contribution_cents
            funded.append({"id": fund.id, "name": fund.name, "amount_cents": fund.monthly_contribution_cents})
        else:
            skipped.append({"id": fund.id, "name": fund.name, "amount_cents": fund.monthly_contribution_cents})
            break  # stop at first fund savings can't cover

    _mark_distribute_executed(db)
    return {
        "funded": funded,
        "skipped": skipped,
        "savings_remaining_cents": savings.balance_cents,
    }


@router.delete("/{fund_id}")
def delete_fund(fund_id: int, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    savings.balance_cents += fund.balance_cents
    db.delete(fund)
    db.commit()
    return {"ok": True}
