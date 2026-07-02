from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter()

VALID_TYPES = {"bill", "fund"}


def _sync_mr_target(db: Session) -> None:
    total = db.query(func.sum(models.Expense.amount_cents)).filter(models.Expense.type == "bill").scalar() or 0
    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    if mr:
        mr.target_cents = total


def _validate_type_and_fund(body_type, fund_id, new_fund_name, db):
    if body_type not in VALID_TYPES:
        raise HTTPException(400, "type must be 'bill' or 'fund'")
    if body_type == "bill" and (fund_id or new_fund_name):
        raise HTTPException(400, "Bill line items cannot have a fund")
    if body_type == "fund" and not fund_id and not new_fund_name:
        raise HTTPException(400, "Fund line items must link to a fund or provide new_fund_name")


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

@router.get("/", response_model=list[schemas.ExpenseOut])
def list_expenses(db: Session = Depends(get_db)):
    return db.query(models.Expense).order_by(models.Expense.category_id.nullslast(), models.Expense.id).all()


@router.post("/", response_model=schemas.ExpenseOut)
def create_expense(body: schemas.ExpenseCreate, db: Session = Depends(get_db)):
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")
    _validate_type_and_fund(body.type, body.fund_id, body.new_fund_name, db)

    resolved_fund_id = body.fund_id

    if body.type == "fund":
        if body.new_fund_name:
            # Inline fund creation
            new_fund = models.Fund(
                name=body.new_fund_name.strip(),
                balance_cents=0,
                monthly_contribution_cents=body.amount_cents,
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

    expense = models.Expense(
        name=body.name,
        type=body.type,
        amount_cents=body.amount_cents,
        actual_cents=body.actual_cents,
        category_id=body.category_id,
        fund_id=resolved_fund_id,
    )
    db.add(expense)
    db.flush()
    _sync_mr_target(db)
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
    _sync_mr_target(db)
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
    _sync_mr_target(db)
    db.commit()
    return {"ok": True}
