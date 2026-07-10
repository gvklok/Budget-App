from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import plans as plans_lib
from database import get_db

router = APIRouter()


def _mark_top_off_executed(db: Session) -> None:
    """U6: record that top-off ran for the current month, so the new-month
    banner stops nagging. Marked even for the 'already at target' no-op case —
    that's still a legitimate handled state, not a failure to retry."""
    year, month = plans_lib.current_year_month(db)
    plan = plans_lib.get_or_create_plan(db, year, month)
    plan.top_off_executed_at = datetime.utcnow()
    db.commit()


@router.post("/top-off")
def top_off(db: Session = Depends(get_db)):
    # U7: top-off always targets the CURRENT (effective) month's Bills total,
    # never whichever month happens to be open on the Expenses page.
    target = plans_lib.current_month_bills_total_cents(db)
    if target == 0:
        raise HTTPException(400, "No bills defined — nothing to top off")

    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()

    shortfall = target - mr.balance_cents
    if shortfall <= 0:
        _mark_top_off_executed(db)
        raise HTTPException(400, "Monthly Reserve is already at or above target")

    if savings.balance_cents < shortfall:
        raise HTTPException(
            400,
            f"Not enough in Savings — need ${shortfall / 100:.2f}, have ${savings.balance_cents / 100:.2f}",
        )

    mr.balance_cents += shortfall
    mr.target_cents = target  # keep stored value in sync
    savings.balance_cents -= shortfall
    _mark_top_off_executed(db)
    return {"ok": True, "moved_cents": shortfall}
