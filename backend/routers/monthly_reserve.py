from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from database import get_db

router = APIRouter()


@router.post("/top-off")
def top_off(db: Session = Depends(get_db)):
    target = (
        db.query(func.sum(models.Expense.amount_cents))
        .filter(models.Expense.type == "bill")
        .scalar() or 0
    )
    if target == 0:
        raise HTTPException(400, "No bills defined — nothing to top off")

    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()

    shortfall = target - mr.balance_cents
    if shortfall <= 0:
        raise HTTPException(400, "Monthly Reserve is already at or above target")

    if savings.balance_cents < shortfall:
        raise HTTPException(
            400,
            f"Not enough in Savings — need ${shortfall / 100:.2f}, have ${savings.balance_cents / 100:.2f}",
        )

    mr.balance_cents += shortfall
    mr.target_cents = target  # keep stored value in sync
    savings.balance_cents -= shortfall
    db.commit()
    return {"ok": True, "moved_cents": shortfall}
