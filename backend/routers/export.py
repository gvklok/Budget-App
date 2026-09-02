import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

import clock
import models
import schemas
from database import get_db

router = APIRouter()


@router.get("/export")
def export_data(db: Session = Depends(get_db)):
    """Local-only backup: a single JSON snapshot of every table. No import
    endpoint (deliberately) — restoring is a Phase-2 decision."""
    real_cash = db.query(models.RealCash).first()
    savings = db.query(models.Savings).first()
    mr = db.query(models.MonthlyReserve).first()
    funds = db.query(models.Fund).order_by(models.Fund.sort_order, models.Fund.id).all()
    monthly_plans = db.query(models.MonthlyPlan).order_by(models.MonthlyPlan.year, models.MonthlyPlan.month).all()
    line_items = db.query(models.Expense).order_by(models.Expense.id).all()
    transactions = db.query(models.Transaction).order_by(models.Transaction.id).all()
    ledger_entries = db.query(models.LedgerEntry).order_by(models.LedgerEntry.id).all()
    income_sources = db.query(models.IncomeSource).order_by(models.IncomeSource.id).all()
    checklist_items = db.query(models.ChecklistItem).order_by(models.ChecklistItem.id).all()
    expense_categories = db.query(models.ExpenseCategory).order_by(models.ExpenseCategory.id).all()
    app_clock = db.query(models.AppClock).first()

    data = {
        "real_cash": schemas.RealCashOut.model_validate(real_cash).model_dump(),
        "savings": schemas.SavingsOut.model_validate(savings).model_dump(),
        "monthly_reserve": schemas.MonthlyReserveOut.model_validate(mr).model_dump(),
        "funds": [schemas.FundOut.model_validate(f).model_dump() for f in funds],
        "monthly_plans": [
            {
                "id": p.id,
                "year": p.year,
                "month": p.month,
                "top_off_executed_at": p.top_off_executed_at.isoformat() if p.top_off_executed_at else None,
                "distribute_executed_at": p.distribute_executed_at.isoformat() if p.distribute_executed_at else None,
            }
            for p in monthly_plans
        ],
        "line_items": [schemas.ExpenseOut.model_validate(i).model_dump() for i in line_items],
        "transactions": [
            {
                "id": t.id,
                "amount_cents": t.amount_cents,
                "date": t.date,
                "merchant": t.merchant,
                "line_item_id": t.line_item_id,
                "fund_id": t.fund_id,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in transactions
        ],
        "ledger_entries": [
            {
                "id": e.id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
                "date": e.date,
                "kind": e.kind,
                "from_bucket": e.from_bucket,
                "to_bucket": e.to_bucket,
                "amount_cents": e.amount_cents,
                "label": e.label,
                "transaction_id": e.transaction_id,
            }
            for e in ledger_entries
        ],
        "income_sources": [schemas.IncomeSourceOut.model_validate(s).model_dump(mode="json") for s in income_sources],
        "checklist_items": [schemas.ChecklistItemOut.model_validate(c).model_dump() for c in checklist_items],
        "expense_categories": [schemas.ExpenseCategoryOut.model_validate(c).model_dump() for c in expense_categories],
        "app_clock": {
            "id": app_clock.id,
            "simulated_date": app_clock.simulated_date,
        } if app_clock else None,
    }

    payload = {
        "app": "budget-app",
        "version": 1,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }

    effective_date = clock.get_current_date(db)
    filename = f"budget-export-{effective_date.isoformat()}.json"

    return Response(
        content=json.dumps(payload),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
