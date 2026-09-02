import calendar
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
import schemas
import ledger
import plans as plans_lib
from clock import get_current_date
from database import get_db

router = APIRouter()

VALID_FREQUENCIES = {"monthly", "semimonthly", "biweekly", "weekly"}


def _clamp_day(year: int, month: int, day: int) -> int:
    """Clamps a calendar day (e.g. 31, or an anchor's day-of-month) to the
    target month's actual last day — how "15th and last day" style schedules
    survive short months."""
    last_day = calendar.monthrange(year, month)[1]
    return min(day, last_day)


def compute_pay_dates(
    frequency: str,
    anchor_date: Optional[date],
    semimonthly_day1: Optional[int],
    semimonthly_day2: Optional[int],
    year: int,
    month: int,
) -> list[date]:
    """Every actual paycheck date that falls in (year, month), derived from the
    source's real schedule — never a flat average. This is what makes "3
    biweekly paychecks this month" fall out naturally instead of being
    hardcoded."""
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])

    if frequency in ("weekly", "biweekly"):
        if anchor_date is None:
            return []
        step_days = 7 if frequency == "weekly" else 14
        # Python's % on a positive divisor always yields a non-negative result,
        # so this lands on the nearest on/after-month_start occurrence of the
        # cadence regardless of whether the anchor is before or after this
        # month — i.e. the cadence extends indefinitely in both directions.
        offset = (month_start - anchor_date).days % step_days
        first = month_start if offset == 0 else month_start + timedelta(days=step_days - offset)
        dates = []
        current = first
        while current <= month_end:
            dates.append(current)
            current += timedelta(days=step_days)
        return dates

    if frequency == "monthly":
        if anchor_date is None:
            return []
        day = _clamp_day(year, month, anchor_date.day)
        return [date(year, month, day)]

    if frequency == "semimonthly":
        if semimonthly_day1 is None or semimonthly_day2 is None:
            return []
        d1 = date(year, month, _clamp_day(year, month, semimonthly_day1))
        d2 = date(year, month, _clamp_day(year, month, semimonthly_day2))
        return sorted({d1, d2})

    return []


def _next_pay_date(source: models.IncomeSource, today: date) -> Optional[date]:
    """Nearest occurrence on or after `today`. Checks the previous month too
    (a weekly/biweekly anchor can still land a future date this month when
    computed from a prior month's window) through the next month."""
    candidates: list[date] = []
    for y, m in _adjacent_year_months(today.year, today.month):
        candidates.extend(compute_pay_dates(
            source.frequency, source.anchor_date,
            source.semimonthly_day1, source.semimonthly_day2, y, m,
        ))
    upcoming = [d for d in candidates if d >= today]
    return min(upcoming) if upcoming else None


def _adjacent_year_months(year: int, month: int) -> list[tuple[int, int]]:
    def shift(y: int, m: int, delta: int) -> tuple[int, int]:
        idx = (y * 12 + (m - 1)) + delta
        return idx // 12, idx % 12 + 1
    return [shift(year, month, -1), (year, month), shift(year, month, 1)]


def _validate_schedule(frequency: str, anchor_date, semimonthly_day1, semimonthly_day2) -> None:
    if frequency in ("weekly", "biweekly", "monthly"):
        if anchor_date is None:
            raise HTTPException(400, "anchor_date is required for weekly, biweekly, and monthly income sources")
    elif frequency == "semimonthly":
        if semimonthly_day1 is None or semimonthly_day2 is None:
            raise HTTPException(400, "semimonthly_day1 and semimonthly_day2 are required for semimonthly income sources")
        for d in (semimonthly_day1, semimonthly_day2):
            if not (1 <= d <= 31):
                raise HTTPException(400, "semimonthly_day1 and semimonthly_day2 must be between 1 and 31")


# ── Income sources CRUD ───────────────────────────────────────────────────────

def _serialize(source: models.IncomeSource, today: date) -> schemas.IncomeSourceOut:
    out = schemas.IncomeSourceOut.model_validate(source)
    out.next_pay_date = _next_pay_date(source, today)
    return out


@router.get("/income-sources", response_model=list[schemas.IncomeSourceOut])
def list_income_sources(db: Session = Depends(get_db)):
    today = get_current_date(db)
    sources = db.query(models.IncomeSource).order_by(models.IncomeSource.id).all()
    return [_serialize(s, today) for s in sources]


@router.post("/income-sources", response_model=schemas.IncomeSourceOut)
def create_income_source(body: schemas.IncomeSourceCreate, db: Session = Depends(get_db)):
    if body.frequency not in VALID_FREQUENCIES:
        raise HTTPException(400, f"frequency must be one of {sorted(VALID_FREQUENCIES)}")
    if body.amount_cents <= 0:
        raise HTTPException(400, "Amount must be positive")
    _validate_schedule(body.frequency, body.anchor_date, body.semimonthly_day1, body.semimonthly_day2)
    source = models.IncomeSource(
        name=body.name,
        amount_cents=body.amount_cents,
        frequency=body.frequency,
        anchor_date=body.anchor_date,
        semimonthly_day1=body.semimonthly_day1,
        semimonthly_day2=body.semimonthly_day2,
    )
    db.add(source)
    db.commit()
    db.refresh(source)
    return _serialize(source, get_current_date(db))


@router.patch("/income-sources/{source_id}", response_model=schemas.IncomeSourceOut)
def update_income_source(source_id: int, body: schemas.IncomeSourceUpdate, db: Session = Depends(get_db)):
    source = db.query(models.IncomeSource).filter(models.IncomeSource.id == source_id).first()
    if not source:
        raise HTTPException(404, "Income source not found")
    if body.name is not None:
        source.name = body.name
    if body.amount_cents is not None:
        if body.amount_cents <= 0:
            raise HTTPException(400, "Amount must be positive")
        source.amount_cents = body.amount_cents
    if body.frequency is not None:
        if body.frequency not in VALID_FREQUENCIES:
            raise HTTPException(400, f"frequency must be one of {sorted(VALID_FREQUENCIES)}")
        source.frequency = body.frequency
    if body.anchor_date is not None:
        source.anchor_date = body.anchor_date
    if body.semimonthly_day1 is not None:
        source.semimonthly_day1 = body.semimonthly_day1
    if body.semimonthly_day2 is not None:
        source.semimonthly_day2 = body.semimonthly_day2
    # Only enforce the schedule requirement when frequency is actively being
    # changed in this request — a plain rename/amount edit on a pre-migration
    # source (no schedule yet) must keep working. compute_pay_dates/_next_pay_date
    # already degrade gracefully (empty/None) when the schedule isn't set, so an
    # unscheduled source just shows no next-pay-date/contributes $0 to the
    # monthly-summary projection until the user adds one — ambient, not blocking.
    if body.frequency is not None:
        _validate_schedule(source.frequency, source.anchor_date, source.semimonthly_day1, source.semimonthly_day2)
    db.commit()
    db.refresh(source)
    return _serialize(source, get_current_date(db))


@router.delete("/income-sources/{source_id}")
def delete_income_source(source_id: int, db: Session = Depends(get_db)):
    source = db.query(models.IncomeSource).filter(models.IncomeSource.id == source_id).first()
    if not source:
        raise HTTPException(404, "Income source not found")
    db.delete(source)
    db.commit()
    return {"ok": True}


class LogPaycheckBody(BaseModel):
    source_id: int
    amount_cents: Optional[int] = None  # override for a bonus/odd check; default = source amount


@router.post("/paycheck")
def log_paycheck(body: LogPaycheckBody, db: Session = Depends(get_db)):
    """Real (non-dev) income entry: a paycheck lands in Savings. Mirrors the
    dev simulate-paycheck mechanic — Savings and Real Cash rise together and
    the ledger records it, which is what powers income in every report."""
    source = db.query(models.IncomeSource).filter(models.IncomeSource.id == body.source_id).first()
    if not source:
        raise HTTPException(404, "Income source not found")
    amount = body.amount_cents if body.amount_cents is not None else source.amount_cents
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")

    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    savings.balance_cents += amount
    rc.balance_cents += amount
    ledger.record(db, kind="paycheck", amount_cents=amount, from_bucket="external", to_bucket="savings", label=source.name)
    db.commit()
    return {"ok": True, "added_cents": amount, "source_id": source.id, "name": source.name}


# ── Monthly summary ───────────────────────────────────────────────────────────
# U3: bills come from the requested (or effective-current, if omitted) month's
# plan. Funds stay month-agnostic — this app's Fund contributions are a global
# property of the Fund itself, not a per-month line item (see U3 notes).

@router.get("/monthly-summary")
def monthly_summary(year: Optional[int] = None, month: Optional[int] = None, db: Session = Depends(get_db)):
    if year is None or month is None:
        year, month = plans_lib.current_year_month(db)

    sources = db.query(models.IncomeSource).all()
    plan = plans_lib.get_plan(db, year, month)
    bills = (
        db.query(models.Expense).filter(models.Expense.plan_id == plan.id, models.Expense.type == "bill").all()
        if plan else []
    )
    funds = db.query(models.Fund).all()
    fund_by_id = {f.id: f for f in funds}

    expected_income = sum(
        s.amount_cents * len(compute_pay_dates(s.frequency, s.anchor_date, s.semimonthly_day1, s.semimonthly_day2, year, month))
        for s in sources
    )

    bills_total = sum(e.amount_cents for e in bills)
    fund_total = sum(f.monthly_contribution_cents for f in funds)
    expenses_total = bills_total + fund_total

    # Actual spending in the requested month (U1 + U3): transfer-out Fund
    # transactions don't count as spending — they moved to another account you
    # own, not out of your net worth.
    bill_line_item_ids = {e.id for e in bills}
    month_prefix = f"{year:04d}-{month:02d}"
    month_txns = db.query(models.Transaction).filter(models.Transaction.date.like(f"{month_prefix}%")).all()
    actual_bills_spent = 0
    actual_fund_spent = 0
    transfers_out_cents = 0

    for tx in month_txns:
        if tx.line_item_id is not None and tx.line_item_id in bill_line_item_ids:
            actual_bills_spent += tx.amount_cents
            continue
        # Resolve the Fund this transaction hits: either a direct fund spend, or
        # a fund line-item transaction (bug 5: the latter was previously counted
        # in neither spending nor transfers-out — resolve its linked fund and
        # treat it exactly like a direct fund_id transaction).
        fund = None
        if tx.fund_id is not None:
            fund = fund_by_id.get(tx.fund_id)
        elif tx.line_item_id is not None:
            line_item = db.query(models.Expense).filter(models.Expense.id == tx.line_item_id).first()
            if line_item is not None and line_item.type == "fund" and line_item.fund_id:
                fund = fund_by_id.get(line_item.fund_id)
        # Classify by the tx's destination SNAPSHOT so a later fund flip or
        # deletion never reclassifies this month; fall back to the live fund's
        # destination for legacy (pre-snapshot) rows. Orphaned spends with no
        # snapshot and no resolvable fund count as external_spend spending —
        # matching the other reporting surfaces so the total agrees.
        destination = tx.destination_type
        if destination is None and fund is not None:
            destination = fund.destination_type
        if destination == "transfer_out":
            transfers_out_cents += tx.amount_cents
        else:
            actual_fund_spent += tx.amount_cents

    return {
        "year": year,
        "month": month,
        "expected_income_cents": expected_income,
        "expected_bills_total_cents": bills_total,
        "expected_fund_contributions_total_cents": fund_total,
        "expected_expenses_total_cents": expenses_total,
        "expected_savings_cents": expected_income - expenses_total,
        "actual_spending_cents": actual_bills_spent + actual_fund_spent,
        "transfers_out_cents": transfers_out_cents,
    }
