from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

import models
from database import get_db

router = APIRouter()


class TargetBody(BaseModel):
    target_cents: int


@router.patch("/target")
def set_target(body: TargetBody, db: Session = Depends(get_db)):
    if body.target_cents < 0:
        raise HTTPException(400, "Target cannot be negative")
    db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).update(
        {"target_cents": body.target_cents}
    )
    db.commit()
    return {"ok": True}


@router.post("/top-off")
def top_off(db: Session = Depends(get_db)):
    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()

    if mr.target_cents == 0:
        raise HTTPException(400, "No target set for Monthly Reserve")

    shortfall = mr.target_cents - mr.balance_cents
    if shortfall <= 0:
        raise HTTPException(400, "Monthly Reserve is already at or above target")

    if savings.balance_cents < shortfall:
        raise HTTPException(
            400,
            f"Not enough in Savings — need ${shortfall / 100:.2f}, have ${savings.balance_cents / 100:.2f}",
        )

    mr.balance_cents += shortfall
    savings.balance_cents -= shortfall
    db.commit()
    return {"ok": True, "moved_cents": shortfall}
