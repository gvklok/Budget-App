from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

import models
from database import get_db

router = APIRouter()


class BalanceBody(BaseModel):
    balance_cents: int


class TargetBody(BaseModel):
    target_cents: int


class FundBalanceBody(BaseModel):
    fund_id: int
    balance_cents: int


class FundContributionBody(BaseModel):
    fund_id: int
    monthly_contribution_cents: int


class SimulateTransactionBody(BaseModel):
    bucket: str
    amount_cents: int
    label: Optional[str] = None


def _resolve_spendable(db: Session, bucket: str):
    if bucket == "savings":
        return db.query(models.Savings).filter(models.Savings.id == 1).first()
    if bucket == "mr":
        return db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    if bucket.startswith("fund:"):
        fund_id = int(bucket.split(":")[1])
        fund = db.query(models.Fund).filter(models.Fund.id == fund_id).first()
        if not fund:
            raise HTTPException(404, f"Fund not found: {fund_id}")
        return fund
    raise HTTPException(400, f"Unknown bucket: {bucket}")


@router.post("/set-real-cash")
def set_real_cash(body: BalanceBody, db: Session = Depends(get_db)):
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    fund_total = db.query(func.coalesce(func.sum(models.Fund.balance_cents), 0)).scalar() or 0

    buckets = savings.balance_cents + mr.balance_cents + fund_total
    delta = body.balance_cents - buckets
    rc.balance_cents = body.balance_cents
    savings.balance_cents += delta
    db.commit()
    return {"ok": True}


@router.post("/set-savings")
def set_savings(body: BalanceBody, db: Session = Depends(get_db)):
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    delta = body.balance_cents - savings.balance_cents
    savings.balance_cents = body.balance_cents
    rc.balance_cents += delta
    db.commit()
    return {"ok": True}


@router.post("/set-mr-balance")
def set_mr_balance(body: BalanceBody, db: Session = Depends(get_db)):
    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    delta = body.balance_cents - mr.balance_cents
    new_savings = savings.balance_cents - delta
    if new_savings < 0:
        raise HTTPException(400, f"Not enough in Savings (would go ${new_savings / 100:.2f})")
    mr.balance_cents = body.balance_cents
    savings.balance_cents = new_savings
    db.commit()
    return {"ok": True}


@router.post("/set-mr-target")
def set_mr_target(body: TargetBody, db: Session = Depends(get_db)):
    db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).update({"target_cents": body.target_cents})
    db.commit()
    return {"ok": True}


@router.post("/set-fund-balance")
def set_fund_balance(body: FundBalanceBody, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == body.fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    delta = body.balance_cents - fund.balance_cents
    new_savings = savings.balance_cents - delta
    if new_savings < 0:
        raise HTTPException(400, f"Not enough in Savings (would go ${new_savings / 100:.2f})")
    fund.balance_cents = body.balance_cents
    savings.balance_cents = new_savings
    db.commit()
    return {"ok": True}


@router.post("/set-fund-contribution")
def set_fund_contribution(body: FundContributionBody, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == body.fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    fund.monthly_contribution_cents = body.monthly_contribution_cents
    db.commit()
    return {"ok": True}


@router.post("/simulate-transaction")
def simulate_transaction(body: SimulateTransactionBody, db: Session = Depends(get_db)):
    bucket = _resolve_spendable(db, body.bucket)

    if bucket.balance_cents < body.amount_cents:
        raise HTTPException(400, "Insufficient balance in bucket")

    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    if rc.balance_cents < body.amount_cents:
        raise HTTPException(400, "Insufficient Real Cash")

    bucket.balance_cents -= body.amount_cents
    rc.balance_cents -= body.amount_cents

    txn = models.SimulatedTransaction(
        bucket_ref=body.bucket,
        amount_cents=body.amount_cents,
        label=body.label,
    )
    db.add(txn)
    db.commit()
    return {"ok": True}


@router.get("/simulated-transactions")
def list_simulated_transactions(db: Session = Depends(get_db)):
    rows = (
        db.query(models.SimulatedTransaction)
        .order_by(models.SimulatedTransaction.id.desc())
        .limit(10)
        .all()
    )
    return [
        {
            "id": r.id,
            "bucket_ref": r.bucket_ref,
            "amount_cents": r.amount_cents,
            "label": r.label,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/reset")
def reset(db: Session = Depends(get_db)):
    db.query(models.SimulatedTransaction).delete()
    db.query(models.Fund).delete()
    db.query(models.RealCash).delete()
    db.query(models.Savings).delete()
    db.query(models.MonthlyReserve).delete()
    db.commit()
    db.add(models.RealCash(id=1, balance_cents=0))
    db.add(models.Savings(id=1, balance_cents=0))
    db.add(models.MonthlyReserve(id=1, balance_cents=0, target_cents=0))
    db.commit()
    return {"ok": True}
