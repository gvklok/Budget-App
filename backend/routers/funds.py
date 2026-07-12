from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, func
from sqlalchemy.orm import Session

import models
import schemas
import plans as plans_lib
import ledger
from database import get_db

router = APIRouter()

VALID_DESTINATION_TYPES = {"external_spend", "transfer_out"}


@router.get("/", response_model=list[schemas.FundOut])
def list_funds(db: Session = Depends(get_db)):
    return db.query(models.Fund).order_by(models.Fund.sort_order, models.Fund.id).all()


class ReorderBody(BaseModel):
    ordered_ids: list[int]


@router.post("/reorder", response_model=list[schemas.FundOut])
def reorder_funds(body: ReorderBody, db: Session = Depends(get_db)):
    existing_ids = {f.id for f in db.query(models.Fund.id).all()}
    if set(body.ordered_ids) != existing_ids:
        raise HTTPException(400, "ordered_ids must contain exactly the full set of existing fund ids")
    funds_by_id = {f.id: f for f in db.query(models.Fund).all()}
    for index, fund_id in enumerate(body.ordered_ids):
        funds_by_id[fund_id].sort_order = index
    db.commit()
    return db.query(models.Fund).order_by(models.Fund.sort_order, models.Fund.id).all()


@router.get("/{fund_id}/detail")
def fund_detail(fund_id: int, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")

    bucket = f"fund:{fund_id}"
    activity = (
        db.query(models.LedgerEntry)
        .filter(or_(models.LedgerEntry.from_bucket == bucket, models.LedgerEntry.to_bucket == bucket))
        .order_by(models.LedgerEntry.date.desc(), models.LedgerEntry.id.desc())
        .all()
    )

    # Reconstruct balance_series by walking newest -> oldest from the CURRENT
    # balance, computing the balance BEFORE each entry.
    running = fund.balance_cents
    points_desc = []  # [(date, balance_after_entry), ...] newest first
    for entry in activity:
        points_desc.append((entry.date, running))
        if entry.to_bucket == bucket:
            running -= entry.amount_cents
        elif entry.from_bucket == bucket:
            running += entry.amount_cents

    points_asc = list(reversed(points_desc))

    # Keep one point per date: the LAST event of that date (i.e. last in
    # ascending order for that date).
    balance_series = []
    for date_str, balance_after in points_asc:
        if balance_series and balance_series[-1]["date"] == date_str:
            balance_series[-1]["balance_cents"] = balance_after
        else:
            balance_series.append({"date": date_str, "balance_cents": balance_after})

    return {
        "fund": schemas.FundOut.model_validate(fund),
        "activity": [schemas.LedgerEntryOut.model_validate(e) for e in activity],
        "balance_series": balance_series,
    }


@router.post("/", response_model=schemas.FundOut)
def create_fund(body: schemas.FundCreate, db: Session = Depends(get_db)):
    if body.destination_type not in VALID_DESTINATION_TYPES:
        raise HTTPException(400, f"destination_type must be one of {sorted(VALID_DESTINATION_TYPES)}")
    if body.color is not None and not schemas.HEX_COLOR_RE.match(body.color):
        raise HTTPException(400, "color must be a hex string like '#5a82c2'")
    if body.balance_cents < 0:
        # A fund can only go negative by spending (U9) — seeding one negative
        # would silently break the invariant since no bucket covers the deficit.
        raise HTTPException(400, "Initial balance cannot be negative")
    if body.balance_cents > 0:
        savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
        if savings.balance_cents < body.balance_cents:
            raise HTTPException(400, "Insufficient savings to fund initial balance")
        savings.balance_cents -= body.balance_cents

    max_sort_order = db.query(func.max(models.Fund.sort_order)).scalar() or 0

    fund = models.Fund(
        name=body.name,
        balance_cents=body.balance_cents,
        monthly_contribution_cents=body.monthly_contribution_cents,
        destination_type=body.destination_type,
        allow_negative_balance=body.allow_negative_balance,
        sort_order=max_sort_order + 1,
        color=body.color,
    )
    db.add(fund)
    db.flush()
    if body.balance_cents > 0:
        ledger.record(db, kind="transfer", amount_cents=body.balance_cents, from_bucket="savings", to_bucket=f"fund:{fund.id}", label="Initial balance")
    db.commit()
    db.refresh(fund)
    return fund


@router.patch("/{fund_id}", response_model=schemas.FundOut)
def update_fund(fund_id: int, body: schemas.FundUpdate, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    if body.name is not None:
        fund.name = body.name
    if body.monthly_contribution_cents is not None:
        fund.monthly_contribution_cents = body.monthly_contribution_cents
    if body.destination_type is not None:
        if body.destination_type not in VALID_DESTINATION_TYPES:
            raise HTTPException(400, f"destination_type must be one of {sorted(VALID_DESTINATION_TYPES)}")
        fund.destination_type = body.destination_type
    if body.allow_negative_balance is not None:
        # U9: switching true->false while already negative is allowed — the
        # existing negative balance persists; only NEW transactions immediately
        # start following the strict (no-further-negative) rule.
        fund.allow_negative_balance = body.allow_negative_balance
    if body.color is not None:
        if not schemas.HEX_COLOR_RE.match(body.color):
            raise HTTPException(400, "color must be a hex string like '#5a82c2'")
        fund.color = body.color
    if "color" in body.model_fields_set and body.color is None:
        fund.color = None
    db.commit()
    db.refresh(fund)
    return fund


def _mark_distribute_executed(db: Session) -> None:
    """U6: record that distribute ran for the current month, so the new-month
    banner stops nagging — marked whenever the action was attempted, funded or
    partially skipped alike."""
    year, month = plans_lib.current_year_month(db)
    plan = plans_lib.get_or_create_plan(db, year, month)
    plan.distribute_executed_at = datetime.utcnow()
    db.commit()


@router.post("/distribute")
def distribute(db: Session = Depends(get_db)):
    # Funding priority follows the user's chosen fund order (sort_order, id) —
    # when savings can't cover everything, funds earlier in that order win.
    funds = (
        db.query(models.Fund)
        .filter(models.Fund.monthly_contribution_cents > 0)
        .order_by(models.Fund.sort_order, models.Fund.id)
        .all()
    )
    if not funds:
        # Bug 4: no contributions is a handled no-op, not a failure — return 200.
        _mark_distribute_executed(db)
        savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
        return {
            "funded": [],
            "skipped": [],
            "savings_remaining_cents": savings.balance_cents,
            "status": "no_contributions",
        }

    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    funded = []
    skipped = []
    stopped = False  # once savings can't cover a fund, fund nothing further (U6)

    for fund in funds:
        if not stopped and savings.balance_cents >= fund.monthly_contribution_cents:
            fund.balance_cents += fund.monthly_contribution_cents
            savings.balance_cents -= fund.monthly_contribution_cents
            ledger.record(db, kind="distribute", amount_cents=fund.monthly_contribution_cents, from_bucket="savings", to_bucket=f"fund:{fund.id}", label=fund.name)
            funded.append({"id": fund.id, "name": fund.name, "amount_cents": fund.monthly_contribution_cents})
        else:
            # Bug 2: report ALL remaining unfunded funds, not just the first that
            # savings couldn't cover — keep stop-at-first-shortfall funding, but
            # don't break out of the reporting loop.
            stopped = True
            skipped.append({"id": fund.id, "name": fund.name, "amount_cents": fund.monthly_contribution_cents})

    _mark_distribute_executed(db)
    return {
        "funded": funded,
        "skipped": skipped,
        "savings_remaining_cents": savings.balance_cents,
        "status": "ok",
    }


@router.delete("/{fund_id}")
def delete_fund(fund_id: int, db: Session = Depends(get_db)):
    fund = db.query(models.Fund).filter(models.Fund.id == fund_id).first()
    if not fund:
        raise HTTPException(404, "Fund not found")
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    savings.balance_cents += fund.balance_cents
    if fund.balance_cents > 0:
        ledger.record(db, kind="transfer", amount_cents=fund.balance_cents, from_bucket=f"fund:{fund.id}", to_bucket="savings", label=f"Fund deleted: {fund.name}")
    elif fund.balance_cents < 0:
        # Savings absorbs the deficit — record the direction that actually moved.
        ledger.record(db, kind="transfer", amount_cents=-fund.balance_cents, from_bucket="savings", to_bucket=f"fund:{fund.id}", label=f"Fund deleted: {fund.name}")
    db.delete(fund)
    db.commit()
    return {"ok": True}
