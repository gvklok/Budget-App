from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import plans as plans_lib
from database import get_db

router = APIRouter()

MAX_MONTHS = 24


def _last_n_months(db: Session, months: int) -> list[tuple[int, int]]:
    """(year, month) pairs ascending, ending at the effective current month."""
    months = max(1, min(months, MAX_MONTHS))
    year, month = plans_lib.current_year_month(db)
    out = []
    for _ in range(months):
        out.append((year, month))
        month -= 1
        if month == 0:
            year -= 1
            month = 12
    out.reverse()
    return out


def _fund_id_from_bucket(bucket: Optional[str]) -> Optional[int]:
    if bucket and bucket.startswith("fund:"):
        try:
            return int(bucket.split(":")[1])
        except ValueError:
            return None
    return None


@router.get("/monthly")
def monthly(months: int = 6, db: Session = Depends(get_db)):
    month_keys = _last_n_months(db, months)
    totals = {
        f"{y:04d}-{m:02d}": {"income_cents": 0, "spent_cents": 0, "transfers_out_cents": 0}
        for y, m in month_keys
    }

    transfer_out_ids = {
        row.id
        for row in db.query(models.Fund.id).filter(models.Fund.destination_type == "transfer_out").all()
    }

    entries = (
        db.query(models.LedgerEntry)
        .filter(models.LedgerEntry.kind.in_(["paycheck", "spend", "spend_reversal"]))
        .all()
    )
    for e in entries:
        month_totals = totals.get(e.date[:7])
        if month_totals is None:
            continue
        if e.kind == "paycheck":
            month_totals["income_cents"] += e.amount_cents
            continue
        # spend: the fund-side bucket is from_bucket; spend_reversal: to_bucket.
        sign = 1 if e.kind == "spend" else -1
        fund_side = e.from_bucket if e.kind == "spend" else e.to_bucket
        fund_id = _fund_id_from_bucket(fund_side)
        # A deleted fund can't be resolved — treat as external_spend; "mr" and
        # "savings" always count as spending.
        if fund_id is not None and fund_id in transfer_out_ids:
            month_totals["transfers_out_cents"] += sign * e.amount_cents
        else:
            month_totals["spent_cents"] += sign * e.amount_cents

    result = []
    for year, month in month_keys:
        t = totals[f"{year:04d}-{month:02d}"]
        result.append({
            "year": year,
            "month": month,
            "income_cents": t["income_cents"],
            "spent_cents": t["spent_cents"],
            "transfers_out_cents": t["transfers_out_cents"],
            "kept_cents": t["income_cents"] - t["spent_cents"] - t["transfers_out_cents"],
        })
    return {"months": result}


@router.get("/spending-breakdown")
def spending_breakdown(
    year: Optional[int] = None,
    month: Optional[int] = None,
    db: Session = Depends(get_db),
):
    if year is None or month is None:
        year, month = plans_lib.current_year_month(db)
    prefix = f"{year:04d}-{month:02d}"

    transactions = (
        db.query(models.Transaction)
        .filter(models.Transaction.date.like(f"{prefix}%"))
        .all()
    )

    line_item_ids = {t.line_item_id for t in transactions if t.line_item_id is not None}
    expenses_by_id = {}
    if line_item_ids:
        for e in db.query(models.Expense).filter(models.Expense.id.in_(line_item_ids)).all():
            expenses_by_id[e.id] = e

    bill_totals: dict[int, int] = {}
    fund_totals: dict[int, int] = {}
    for t in transactions:
        line_item = expenses_by_id.get(t.line_item_id) if t.line_item_id is not None else None
        if line_item is not None and line_item.type == "bill":
            bill_totals[line_item.id] = bill_totals.get(line_item.id, 0) + t.amount_cents
        elif line_item is not None and line_item.type == "fund" and line_item.fund_id is not None:
            fund_totals[line_item.fund_id] = fund_totals.get(line_item.fund_id, 0) + t.amount_cents
        elif t.fund_id is not None:
            fund_totals[t.fund_id] = fund_totals.get(t.fund_id, 0) + t.amount_cents

    funds_by_id = {}
    if fund_totals:
        for f in db.query(models.Fund).filter(models.Fund.id.in_(fund_totals)).all():
            funds_by_id[f.id] = f

    bills = sorted(
        (
            {"line_item_id": lid, "name": expenses_by_id[lid].name, "spent_cents": total}
            for lid, total in bill_totals.items()
        ),
        key=lambda b: b["spent_cents"],
        reverse=True,
    )
    funds = sorted(
        (
            {
                "fund_id": fid,
                "name": funds_by_id[fid].name if fid in funds_by_id else None,
                "spent_cents": total,
                "destination_type": funds_by_id[fid].destination_type if fid in funds_by_id else "external_spend",
            }
            for fid, total in fund_totals.items()
        ),
        key=lambda f: f["spent_cents"],
        reverse=True,
    )
    return {"bills": bills, "funds": funds}


_SERIES_KEYS = ("savings", "mr", "funds_total", "real_cash")


def _series_bucket(bucket: Optional[str]) -> Optional[str]:
    if bucket in ("savings", "mr"):
        return bucket
    if bucket and bucket.startswith("fund:"):
        return "funds_total"
    return None  # "external" or absent — handled via real_cash


@router.get("/balance-series")
def balance_series(months: int = 6, db: Session = Depends(get_db)):
    month_keys = _last_n_months(db, months)
    start_year, start_month = month_keys[0]
    window_start = f"{start_year:04d}-{start_month:02d}-01"

    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()
    fund_total = db.query(func.coalesce(func.sum(models.Fund.balance_cents), 0)).scalar() or 0

    balances = {
        "savings": savings.balance_cents if savings else 0,
        "mr": mr.balance_cents if mr else 0,
        "funds_total": fund_total,
        "real_cash": rc.balance_cents if rc else 0,
    }

    entries = (
        db.query(models.LedgerEntry)
        .filter(models.LedgerEntry.date >= window_start)
        .order_by(models.LedgerEntry.date.desc(), models.LedgerEntry.id.desc())
        .all()
    )

    # Walk newest -> oldest: `balances` always holds the state AFTER the entry
    # about to be processed. The first entry seen for a date is the last event
    # of that date, so snapshot then; subsequent same-date entries just reverse.
    points_desc = []  # [(date, {series: balance_after}), ...] newest first
    seen_dates = set()
    for e in entries:
        if e.date not in seen_dates:
            seen_dates.add(e.date)
            points_desc.append((e.date, dict(balances)))
        # Reverse the entry to get the state before it.
        from_series = _series_bucket(e.from_bucket)
        to_series = _series_bucket(e.to_bucket)
        if from_series:
            balances[from_series] += e.amount_cents
        if to_series:
            balances[to_series] -= e.amount_cents
        # Real Cash changes only when one side is "external".
        if e.from_bucket == "external" and e.to_bucket != "external":
            balances["real_cash"] -= e.amount_cents  # money in: before = after - amount
        elif e.to_bucket == "external" and e.from_bucket != "external":
            balances["real_cash"] += e.amount_cents  # money out: before = after + amount

    points_asc = list(reversed(points_desc))

    series = {key: [] for key in _SERIES_KEYS}
    # Leading point: the balance as of just before the window (so charts don't
    # start at zero) — unless an event already landed on the window-start date.
    if not points_asc or points_asc[0][0] != window_start:
        for key in _SERIES_KEYS:
            series[key].append({"date": window_start, "balance_cents": balances[key]})
    for date_str, snapshot in points_asc:
        for key in _SERIES_KEYS:
            series[key].append({"date": date_str, "balance_cents": snapshot[key]})

    return {"series": series}
