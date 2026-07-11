from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
import plans as plans_lib
from database import get_db

router = APIRouter()

VALID_TYPES = {"bill", "fund"}


def _validate_type_and_fund(body_type, fund_id, new_fund_name, db):
    if body_type not in VALID_TYPES:
        raise HTTPException(400, "type must be 'bill' or 'fund'")
    if body_type == "bill" and (fund_id or new_fund_name):
        raise HTTPException(400, "Bill line items cannot have a fund")
    if body_type == "fund" and not fund_id and not new_fund_name:
        raise HTTPException(400, "Fund line items must link to a fund or provide new_fund_name")


class ReallocateBody(BaseModel):
    increased_line_item_id: int
    decreased_line_item_id: int
    amount_cents: int


@router.post("/reallocate")
def reallocate(body: ReallocateBody, db: Session = Depends(get_db)):
    # U5: the "increased" Bill was already bumped up via a normal PATCH before
    # this is called — this endpoint only performs the offsetting decrease, so
    # the total Bills sum (and therefore MR target) stays exactly unchanged.
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")
    if body.increased_line_item_id == body.decreased_line_item_id:
        raise HTTPException(400, "Must pick a different Bill to reduce")
    increased = db.query(models.Expense).filter(models.Expense.id == body.increased_line_item_id).first()
    decreased = db.query(models.Expense).filter(models.Expense.id == body.decreased_line_item_id).first()
    if not increased or not decreased:
        raise HTTPException(404, "Line item not found")
    if increased.type != "bill" or decreased.type != "bill":
        raise HTTPException(400, "Reallocation only applies to Bills")
    if decreased.amount_cents - body.amount_cents < 0:
        raise HTTPException(400, f"{decreased.name} would go below zero — pick a different Bill or a smaller amount")
    decreased.amount_cents -= body.amount_cents
    plans_lib.sync_mr_target(db)
    db.commit()
    db.refresh(increased)
    db.refresh(decreased)
    return {
        "increased": schemas.ExpenseOut.model_validate(increased),
        "decreased": schemas.ExpenseOut.model_validate(decreased),
    }


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=list[schemas.ExpenseCategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(models.ExpenseCategory).order_by(models.ExpenseCategory.id).all()


@router.post("/categories", response_model=schemas.ExpenseCategoryOut)
def create_category(body: schemas.ExpenseCategoryCreate, db: Session = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(400, "Name is required")
    cat = models.ExpenseCategory(name=body.name.strip())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.patch("/categories/{cat_id}", response_model=schemas.ExpenseCategoryOut)
def update_category(cat_id: int, body: schemas.ExpenseCategoryCreate, db: Session = Depends(get_db)):
    cat = db.query(models.ExpenseCategory).filter(models.ExpenseCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    cat.name = body.name.strip()
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    cat = db.query(models.ExpenseCategory).filter(models.ExpenseCategory.id == cat_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    db.delete(cat)
    db.commit()
    return {"ok": True}


# ── Line items ────────────────────────────────────────────────────────────────
# U3: line items are scoped to a MonthlyPlan. year/month are optional on read
# (default to the effective current month) but resolve to a real plan on write —
# auto-creating it if this is the first item added to that month.

@router.get("/", response_model=list[schemas.ExpenseOut])
def list_expenses(year: Optional[int] = None, month: Optional[int] = None, db: Session = Depends(get_db)):
    if year is None or month is None:
        year, month = plans_lib.current_year_month(db)
    plan = plans_lib.get_plan(db, year, month)
    if not plan:
        return []
    return (
        db.query(models.Expense)
        .filter(models.Expense.plan_id == plan.id)
        .order_by(models.Expense.category_id.nullslast(), models.Expense.sort_order, models.Expense.id)
        .all()
    )


class ReorderItemsBody(BaseModel):
    ordered_ids: list[int]


@router.post("/reorder", response_model=list[schemas.ExpenseOut])
def reorder_line_items(body: ReorderItemsBody, db: Session = Depends(get_db)):
    if not body.ordered_ids:
        raise HTTPException(400, "ordered_ids must not be empty")
    items = db.query(models.Expense).filter(models.Expense.id.in_(body.ordered_ids)).all()
    items_by_id = {item.id: item for item in items}
    if set(items_by_id.keys()) != set(body.ordered_ids):
        raise HTTPException(400, "ordered_ids must all reference existing line items")
    plan_ids = {item.plan_id for item in items}
    if len(plan_ids) > 1:
        raise HTTPException(400, "ordered_ids must all belong to the same plan")
    for index, item_id in enumerate(body.ordered_ids):
        items_by_id[item_id].sort_order = index
    db.commit()
    plan_id = plan_ids.pop()
    return (
        db.query(models.Expense)
        .filter(models.Expense.plan_id == plan_id)
        .order_by(models.Expense.category_id.nullslast(), models.Expense.sort_order, models.Expense.id)
        .all()
    )


@router.post("/", response_model=schemas.ExpenseOut)
def create_expense(body: schemas.ExpenseCreate, db: Session = Depends(get_db)):
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")
    _validate_type_and_fund(body.type, body.fund_id, body.new_fund_name, db)

    year, month = (body.year, body.month) if body.year and body.month else plans_lib.current_year_month(db)
    # U4: first touch of an unplanned month initializes it from the most recent
    # prior plan — same as navigating to it. Creating an item must not sidestep
    # the copy and leave a sparse plan behind.
    plan = plans_lib.get_or_autoload_plan(db, year, month)

    resolved_fund_id = body.fund_id

    if body.type == "fund":
        if body.new_fund_name:
            # Inline fund creation
            max_fund_sort_order = db.query(func.max(models.Fund.sort_order)).scalar() or 0
            new_fund = models.Fund(
                name=body.new_fund_name.strip(),
                balance_cents=0,
                monthly_contribution_cents=body.amount_cents,
                sort_order=max_fund_sort_order + 1,
            )
            db.add(new_fund)
            db.flush()
            resolved_fund_id = new_fund.id
        else:
            fund = db.query(models.Fund).filter(models.Fund.id == body.fund_id).first()
            if not fund:
                raise HTTPException(404, "Fund not found")

    if body.category_id is not None:
        if not db.query(models.ExpenseCategory).filter(models.ExpenseCategory.id == body.category_id).first():
            raise HTTPException(404, "Category not found")

    max_item_sort_order = (
        db.query(func.max(models.Expense.sort_order))
        .filter(models.Expense.plan_id == plan.id)
        .scalar()
        or 0
    )

    expense = models.Expense(
        name=body.name,
        type=body.type,
        amount_cents=body.amount_cents,
        actual_cents=body.actual_cents,
        category_id=body.category_id,
        fund_id=resolved_fund_id,
        plan_id=plan.id,
        sort_order=max_item_sort_order + 1,
    )
    db.add(expense)
    db.flush()
    plans_lib.sync_mr_target(db)
    db.commit()
    db.refresh(expense)
    return expense


@router.patch("/{expense_id}", response_model=schemas.ExpenseOut)
def update_expense(expense_id: int, body: schemas.ExpenseUpdate, db: Session = Depends(get_db)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(404, "Line item not found")
    if body.name is not None:
        expense.name = body.name
    if body.type is not None:
        if body.type not in VALID_TYPES:
            raise HTTPException(400, "type must be 'bill' or 'fund'")
        expense.type = body.type
    if body.amount_cents is not None:
        if body.amount_cents <= 0:
            raise HTTPException(400, "Amount must be positive")
        expense.amount_cents = body.amount_cents
    if body.actual_cents is not None:
        expense.actual_cents = body.actual_cents
    if body.category_id is not None:
        if not db.query(models.ExpenseCategory).filter(models.ExpenseCategory.id == body.category_id).first():
            raise HTTPException(404, "Category not found")
        expense.category_id = body.category_id
    if "category_id" in body.model_fields_set and body.category_id is None:
        expense.category_id = None
    if body.fund_id is not None:
        expense.fund_id = body.fund_id
    if "fund_id" in body.model_fields_set and body.fund_id is None:
        expense.fund_id = None
    plans_lib.sync_mr_target(db)
    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(404, "Line item not found")
    db.delete(expense)
    db.flush()
    plans_lib.sync_mr_target(db)
    db.commit()
    return {"ok": True}
