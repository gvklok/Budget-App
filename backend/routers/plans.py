from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
import plans as plans_lib
from database import get_db

router = APIRouter()


def _plan_response(db: Session, year: int, month: int):
    plan = plans_lib.get_plan(db, year, month)
    if not plan:
        return {"year": year, "month": month, "planned": False, "plan_id": None, "line_items": []}
    # Category display order is driven by the category's own sort_order (user-
    # reorderable), not by category_id/creation order — outerjoin so items with
    # no category (category_id NULL) still come through, sorted last.
    items = (
        db.query(models.Expense)
        .outerjoin(models.ExpenseCategory, models.Expense.category_id == models.ExpenseCategory.id)
        .filter(models.Expense.plan_id == plan.id)
        .order_by(
            models.ExpenseCategory.sort_order.nullslast(),
            models.Expense.sort_order,
            models.Expense.id,
        )
        .all()
    )
    return {
        "year": year,
        "month": month,
        "planned": True,
        "plan_id": plan.id,
        "line_items": [schemas.ExpenseOut.model_validate(i) for i in items],
    }


@router.get("/{year}/{month}")
def get_plan(year: int, month: int, db: Session = Depends(get_db)):
    # U4: navigating to an unplanned month auto-initializes it (copying forward
    # from the most recent prior planned month, if any).
    plans_lib.get_or_autoload_plan(db, year, month)
    return _plan_response(db, year, month)


@router.post("/{year}/{month}")
def create_plan(year: int, month: int, db: Session = Depends(get_db)):
    plans_lib.get_or_create_plan(db, year, month)
    db.commit()
    return _plan_response(db, year, month)
