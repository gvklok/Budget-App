from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter()


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
    # FK ondelete=SET NULL handles nullifying expenses in this category
    db.delete(cat)
    db.commit()
    return {"ok": True}


# ── Expenses ──────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[schemas.ExpenseOut])
def list_expenses(db: Session = Depends(get_db)):
    return db.query(models.Expense).order_by(models.Expense.category_id.nullslast(), models.Expense.id).all()


@router.post("/", response_model=schemas.ExpenseOut)
def create_expense(body: schemas.ExpenseCreate, db: Session = Depends(get_db)):
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")
    if body.category_id is not None:
        if not db.query(models.ExpenseCategory).filter(models.ExpenseCategory.id == body.category_id).first():
            raise HTTPException(404, "Category not found")
    expense = models.Expense(
        name=body.name,
        amount_cents=body.amount_cents,
        actual_cents=body.actual_cents,
        category_id=body.category_id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


@router.patch("/{expense_id}", response_model=schemas.ExpenseOut)
def update_expense(expense_id: int, body: schemas.ExpenseUpdate, db: Session = Depends(get_db)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(404, "Expense not found")
    if body.name is not None:
        expense.name = body.name
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
    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db)):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(404, "Expense not found")
    db.delete(expense)
    db.commit()
    return {"ok": True}
