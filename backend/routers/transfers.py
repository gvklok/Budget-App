from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
import ledger
from database import get_db

router = APIRouter()


def _resolve(db: Session, bucket: str):
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


@router.post("/")
def transfer(body: schemas.TransferBody, db: Session = Depends(get_db)):
    if body.from_bucket == body.to_bucket:
        raise HTTPException(400, "Source and destination must be different")
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")

    source = _resolve(db, body.from_bucket)
    dest = _resolve(db, body.to_bucket)

    if source.balance_cents < body.amount_cents:
        raise HTTPException(400, "Insufficient balance in source bucket")

    source.balance_cents -= body.amount_cents
    dest.balance_cents += body.amount_cents
    ledger.record(
        db,
        kind="transfer",
        amount_cents=body.amount_cents,
        from_bucket=body.from_bucket,
        to_bucket=body.to_bucket,
    )
    db.commit()
    return {"ok": True}
