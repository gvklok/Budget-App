from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

import models
import ledger
import plans as plans_lib
from database import get_db
from clock import get_current_date

router = APIRouter()


class BalanceBody(BaseModel):
    balance_cents: int


class TargetBody(BaseModel):
    target_cents: int


class FundBalanceBody(BaseModel):
    fund_id: int
    balance_cents: int


class FundContributionBody(BaseModel):
    fund_id: int
    monthly_contribution_cents: int


class SimulateTransactionBody(BaseModel):
    bucket: str
    amount_cents: int
    label: Optional[str] = None
    destination_type: Optional[str] = "external_spend"  # meaningful when bucket == "savings" (U1)


class SetSimulatedDateBody(BaseModel):
    date: str  # YYYY-MM-DD


def _resolve_spendable(db: Session, bucket: str):
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


@router.post("/set-real-cash")
def set_real_cash(body: BalanceBody, db: Session = Depends(get_db)):
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    fund_total = db.query(func.coalesce(func.sum(models.Fund.balance_cents), 0)).scalar() or 0

    buckets = savings.balance_cents + mr.balance_cents + fund_total
    delta = body.balance_cents - buckets
    rc.balance_cents = body.balance_cents
    savings.balance_cents += delta
    if delta > 0:
        ledger.record(db, kind="adjustment", amount_cents=delta, from_bucket="external", to_bucket="savings", label="Set Real Cash")
    elif delta < 0:
        ledger.record(db, kind="adjustment", amount_cents=-delta, from_bucket="savings", to_bucket="external", label="Set Real Cash")
    db.commit()
    return {"ok": True}


@router.post("/set-savings")
def set_savings(body: BalanceBody, db: Session = Depends(get_db)):
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    delta = body.balance_cents - savings.balance_cents
    savings.balance_cents = body.balance_cents
    rc.balance_cents += delta
    if delta > 0:
        ledger.record(db, kind="adjustment", amount_cents=delta, from_bucket="external", to_bucket="savings", label="Set Savings")
    elif delta < 0:
        ledger.record(db, kind="adjustment", amount_cents=-delta, from_bucket="savings", to_bucket="external", label="Set Savings")
    db.commit()
    return {"ok": True}


@router.post("/set-mr-balance")
def set_mr_balance(body: BalanceBody, db: Session = Depends(get_db)):
    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    delta = body.balance_cents - mr.balance_cents
    new_savings = savings.balance_cents - delta
    if new_savings < 0:
        raise HTTPException(400, f"Not enough in Savings (would go ${new_savings / 100:.2f})")
    mr.balance_cents = body.balance_cents
    savings.balance_cents = new_savings
    if delta > 0:
        ledger.record(db, kind="adjustment", amount_cents=delta, from_bucket="savings", to_bucket="mr", label="Set Monthly Reserve")
    elif delta < 0:
        ledger.record(db, kind="adjustment", amount_cents=-delta, from_bucket="mr", to_bucket="savings", label="Set Monthly Reserve")
    db.commit()
    return {"ok": True}


@router.post("/set-mr-target")
def set_mr_target(body: TargetBody, db: Session = Depends(get_db)):
    db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).update({"target_cents": body.target_cents})
    db.commit()
    return {"ok": True}


@router.post("/set-fund-balance")
def set_fund_balance(body: FundBalanceBody, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == body.fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    delta = body.balance_cents - fund.balance_cents
    new_savings = savings.balance_cents - delta
    if new_savings < 0:
        raise HTTPException(400, f"Not enough in Savings (would go ${new_savings / 100:.2f})")
    fund.balance_cents = body.balance_cents
    savings.balance_cents = new_savings
    if delta > 0:
        ledger.record(db, kind="adjustment", amount_cents=delta, from_bucket="savings", to_bucket=f"fund:{fund.id}", label="Set Fund balance")
    elif delta < 0:
        ledger.record(db, kind="adjustment", amount_cents=-delta, from_bucket=f"fund:{fund.id}", to_bucket="savings", label="Set Fund balance")
    db.commit()
    return {"ok": True}


@router.post("/set-fund-contribution")
def set_fund_contribution(body: FundContributionBody, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == body.fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    fund.monthly_contribution_cents = body.monthly_contribution_cents
    db.commit()
    return {"ok": True}


_MULTIPLIERS = {"monthly": 1, "semimonthly": 2, "biweekly": 26 / 12, "weekly": 52 / 12}


@router.post("/simulate-paycheck")
def simulate_paycheck(db: Session = Depends(get_db)):
    sources = db.query(models.IncomeSource).all()
    if not sources:
        raise HTTPException(400, "No income sources configured — add one on the Expenses page")
    monthly_cents = sum(round(s.amount_cents * _MULTIPLIERS[s.frequency]) for s in sources)
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    savings.balance_cents += monthly_cents
    rc.balance_cents += monthly_cents
    ledger.record(db, kind="paycheck", amount_cents=monthly_cents, from_bucket="external", to_bucket="savings", label="Paycheck")
    db.commit()
    return {"ok": True, "added_cents": monthly_cents}


@router.post("/simulate-transaction")
def simulate_transaction(body: SimulateTransactionBody, db: Session = Depends(get_db)):
    if body.destination_type not in ("external_spend", "transfer_out"):
        raise HTTPException(400, "destination_type must be 'external_spend' or 'transfer_out'")

    bucket = _resolve_spendable(db, body.bucket)

    # U9: a Fund tagged allow_negative_balance may go below zero freely.
    bucket_allows_negative = isinstance(bucket, models.Fund) and bucket.allow_negative_balance
    if not bucket_allows_negative and bucket.balance_cents < body.amount_cents:
        raise HTTPException(400, "Insufficient balance in bucket")

    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    if rc.balance_cents < body.amount_cents:
        raise HTTPException(400, "Insufficient Real Cash")

    bucket.balance_cents -= body.amount_cents
    rc.balance_cents -= body.amount_cents

    txn = models.SimulatedTransaction(
        bucket_ref=body.bucket,
        amount_cents=body.amount_cents,
        label=body.label,
        destination_type=body.destination_type or "external_spend",
    )
    db.add(txn)
    ledger.record(
        db,
        kind="spend",
        amount_cents=body.amount_cents,
        from_bucket=body.bucket,
        to_bucket="external",
        label=body.label or "Simulated",
    )
    db.commit()
    return {"ok": True}


@router.get("/simulated-transactions")
def list_simulated_transactions(db: Session = Depends(get_db)):
    rows = (
        db.query(models.SimulatedTransaction)
        .order_by(models.SimulatedTransaction.id.desc())
        .limit(10)
        .all()
    )
    return [
        {
            "id": r.id,
            "bucket_ref": r.bucket_ref,
            "amount_cents": r.amount_cents,
            "label": r.label,
            "destination_type": r.destination_type,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ── Simulated date / AppClock (U2) ─────────────────────────────────────────────

@router.post("/set-simulated-date")
def set_simulated_date(body: SetSimulatedDateBody, db: Session = Depends(get_db)):
    try:
        date.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    clock = db.query(models.AppClock).filter(models.AppClock.id == 1).first()
    clock.simulated_date = body.date
    # Changing the effective date can change the effective month — the MR
    # target (Σ current-month Bills) must follow immediately, not wait for the
    # next line-item edit.
    plans_lib.sync_mr_target(db)
    db.commit()
    return {"ok": True, "simulated_date": clock.simulated_date}


@router.post("/clear-simulated-date")
def clear_simulated_date(db: Session = Depends(get_db)):
    clock = db.query(models.AppClock).filter(models.AppClock.id == 1).first()
    clock.simulated_date = None
    plans_lib.sync_mr_target(db)
    db.commit()
    return {"ok": True}


@router.get("/current-date")
def current_date(db: Session = Depends(get_db)):
    clock = db.query(models.AppClock).filter(models.AppClock.id == 1).first()
    effective = get_current_date(db)
    return {
        "effective_date": effective.isoformat(),
        "simulated_date": clock.simulated_date if clock else None,
        "is_simulated": bool(clock and clock.simulated_date),
    }


@router.post("/reset")
def reset(db: Session = Depends(get_db)):
    db.query(models.Transaction).delete()
    db.query(models.SimulatedTransaction).delete()
    db.query(models.LedgerEntry).delete()
    db.query(models.Expense).delete()
    db.query(models.ExpenseCategory).delete()
    db.query(models.IncomeSource).delete()
    db.query(models.Fund).delete()
    db.query(models.ChecklistItem).delete()
    # Bug 1: stale MonthlyPlan rows (with top_off/distribute_executed_at) survived
    # reset and suppressed the new-month banner — clear them too.
    db.query(models.MonthlyPlan).delete()
    db.query(models.RealCash).delete()
    db.query(models.Savings).delete()
    db.query(models.MonthlyReserve).delete()
    db.query(models.AppClock).delete()
    db.commit()
    db.add(models.RealCash(id=1, balance_cents=0))
    db.add(models.Savings(id=1, balance_cents=0))
    db.add(models.MonthlyReserve(id=1, balance_cents=0, target_cents=0))
    db.add(models.AppClock(id=1, simulated_date=None))
    db.commit()
    return {"ok": True}
