from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter()


@router.get("/", response_model=list[schemas.FundOut])
def list_funds(db: Session = Depends(get_db)):
    return db.query(models.Fund).order_by(models.Fund.id).all()


@router.post("/", response_model=schemas.FundOut)
def create_fund(body: schemas.FundCreate, db: Session = Depends(get_db)):
    if body.balance_cents > 0:
        savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
        if savings.balance_cents < body.balance_cents:
            raise HTTPException(400, "Insufficient savings to fund initial balance")
        savings.balance_cents -= body.balance_cents

    fund = models.Fund(
        name=body.name,
        balance_cents=body.balance_cents,
        monthly_contribution_cents=body.monthly_contribution_cents,
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
    db.commit()
    db.refresh(fund)
    return fund


@router.post("/distribute")
def distribute(db: Session = Depends(get_db)):
    funds = db.query(models.Fund).filter(models.Fund.monthly_contribution_cents > 0).all()
    if not funds:
        raise HTTPException(400, "No funds have a monthly contribution set")

    total = sum(f.monthly_contribution_cents for f in funds)
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()

    if savings.balance_cents < total:
        raise HTTPException(
            400,
            f"Not enough in Savings — need ${total / 100:.2f}, have ${savings.balance_cents / 100:.2f}",
        )

    for fund in funds:
        fund.balance_cents += fund.monthly_contribution_cents
        savings.balance_cents -= fund.monthly_contribution_cents

    db.commit()
    return {"ok": True, "distributed_cents": total}


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
