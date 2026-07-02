from datetime import date as date_type
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter()


def _debit(tx: models.Transaction, db: Session) -> None:
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()

    if tx.line_item_id is not None:
        line_item = db.query(models.Expense).filter(models.Expense.id == tx.line_item_id).first()
        if line_item.type == "bill":
            mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
            if mr.balance_cents < tx.amount_cents:
                raise HTTPException(
                    400,
                    f"Monthly Reserve has insufficient funds — need ${tx.amount_cents / 100:.2f}, have ${mr.balance_cents / 100:.2f}",
                )
            mr.balance_cents -= tx.amount_cents
        elif line_item.type == "fund":
            if not line_item.fund_id:
                raise HTTPException(400, "Fund line item has no linked fund")
            fund = db.query(models.Fund).filter(models.Fund.id == line_item.fund_id).first()
            if not fund:
                raise HTTPException(404, "Linked fund not found")
            if fund.balance_cents < tx.amount_cents:
                raise HTTPException(
                    400,
                    f"{fund.name} has insufficient funds — need ${tx.amount_cents / 100:.2f}, have ${fund.balance_cents / 100:.2f}",
                )
            fund.balance_cents -= tx.amount_cents
    elif tx.fund_id is not None:
        fund = db.query(models.Fund).filter(models.Fund.id == tx.fund_id).first()
        if not fund:
            raise HTTPException(404, "Fund not found")
        if fund.balance_cents < tx.amount_cents:
            raise HTTPException(
                400,
                f"{fund.name} has insufficient funds — need ${tx.amount_cents / 100:.2f}, have ${fund.balance_cents / 100:.2f}",
            )
        fund.balance_cents -= tx.amount_cents

    rc.balance_cents -= tx.amount_cents


def _credit(tx: models.Transaction, db: Session) -> None:
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()

    if tx.line_item_id is not None:
        line_item = db.query(models.Expense).filter(models.Expense.id == tx.line_item_id).first()
        if line_item and line_item.type == "bill":
            mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
            mr.balance_cents += tx.amount_cents
        elif line_item and line_item.type == "fund" and line_item.fund_id:
            fund = db.query(models.Fund).filter(models.Fund.id == line_item.fund_id).first()
            if fund:
                fund.balance_cents += tx.amount_cents
    elif tx.fund_id is not None:
        fund = db.query(models.Fund).filter(models.Fund.id == tx.fund_id).first()
        if fund:
            fund.balance_cents += tx.amount_cents

    rc.balance_cents += tx.amount_cents


@router.get("/", response_model=list[schemas.TransactionOut])
def list_transactions(db: Session = Depends(get_db)):
    return db.query(models.Transaction).order_by(models.Transaction.date.desc(), models.Transaction.id.desc()).all()


@router.post("/", response_model=schemas.TransactionOut)
def create_transaction(body: schemas.TransactionCreate, db: Session = Depends(get_db)):
    try:
        date_type.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")
    if body.line_item_id is None and body.fund_id is None:
        raise HTTPException(400, "Must provide either line_item_id or fund_id")
    if body.line_item_id is not None and body.fund_id is not None:
        raise HTTPException(400, "Provide only one of line_item_id or fund_id")

    if body.line_item_id is not None:
        if not db.query(models.Expense).filter(models.Expense.id == body.line_item_id).first():
            raise HTTPException(404, "Line item not found")
    if body.fund_id is not None:
        if not db.query(models.Fund).filter(models.Fund.id == body.fund_id).first():
            raise HTTPException(404, "Fund not found")

    tx = models.Transaction(
        amount_cents=body.amount_cents,
        date=body.date,
        merchant=body.merchant or None,
        line_item_id=body.line_item_id,
        fund_id=body.fund_id,
    )
    db.add(tx)
    db.flush()
    _debit(tx, db)
    db.commit()
    db.refresh(tx)
    return tx


@router.delete("/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(404, "Transaction not found")
    _credit(tx, db)
    db.delete(tx)
    db.commit()
    return {"ok": True}
