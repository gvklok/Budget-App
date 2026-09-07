from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import plans as plans_lib
from database import get_db
from routers.transactions import _deleted_fund_names

router = APIRouter()

MAX_MONTHS = 24


def _last_n_months(db: Session, months: int, end: Optional[tuple[int, int]] = None) -> list[tuple[int, int]]:
    """(year, month) pairs ascending, ending at `end` (default: the effective
    current month)."""
    months = max(1, min(months, MAX_MONTHS))
    year, month = end if end else plans_lib.current_year_month(db)
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
        f"{y:04d}-{m:02d}": {"income_cents": 0, "bills_spent_cents": 0, "funds_spent_cents": 0, "transfers_out_cents": 0}
        for y, m in month_keys
    }

    transfer_out_ids = {
        row.id
        for row in db.query(models.Fund.id).filter(models.Fund.destination_type == "transfer_out").all()
    }

    entries = (
        db.query(models.LedgerEntry)
        .filter(models.LedgerEntry.kind.in_(["paycheck", "misc_income", "spend", "spend_reversal"]))
        .all()
    )
    for e in entries:
        month_totals = totals.get(e.date[:7])
        if month_totals is None:
            continue
        if e.kind in ("paycheck", "misc_income"):
            month_totals["income_cents"] += e.amount_cents
            continue
        # spend: the fund-side bucket is from_bucket; spend_reversal: to_bucket.
        sign = 1 if e.kind == "spend" else -1
        fund_side = e.from_bucket if e.kind == "spend" else e.to_bucket
        fund_id = _fund_id_from_bucket(fund_side)
        if fund_id is None:
            # "mr" (bills) — and rare direct savings withdrawals — count with bills.
            month_totals["bills_spent_cents"] += sign * e.amount_cents
            continue
        # Classify by the entry's destination SNAPSHOT so a later fund flip never
        # reclassifies this month. Legacy nulls fall back to the live fund (a
        # since-deleted fund stays external_spend — i.e. ordinary fund spending).
        if e.destination_type is not None:
            is_transfer_out = e.destination_type == "transfer_out"
        else:
            is_transfer_out = fund_id in transfer_out_ids
        if is_transfer_out:
            month_totals["transfers_out_cents"] += sign * e.amount_cents
        else:
            month_totals["funds_spent_cents"] += sign * e.amount_cents

    result = []
    for year, month in month_keys:
        t = totals[f"{year:04d}-{month:02d}"]
        spent = t["bills_spent_cents"] + t["funds_spent_cents"]
        result.append({
            "year": year,
            "month": month,
            "income_cents": t["income_cents"],
            "spent_cents": spent,
            "bills_spent_cents": t["bills_spent_cents"],
            "funds_spent_cents": t["funds_spent_cents"],
            "transfers_out_cents": t["transfers_out_cents"],
            "kept_cents": t["income_cents"] - spent - t["transfers_out_cents"],
        })
    return {"months": result}


@router.get("/spending-breakdown")
def spending_breakdown(
    year: Optional[int] = None,
    month: Optional[int] = None,
    months: int = 1,
    db: Session = Depends(get_db),
):
    if year is None or month is None:
        year, month = plans_lib.current_year_month(db)

    # months > 1 aggregates the window of `months` ending at (year, month).
    # The months are contiguous, so a simple date-string range covers them.
    window = _last_n_months(db, months, end=(year, month))
    start_prefix = f"{window[0][0]:04d}-{window[0][1]:02d}"
    end_prefix = f"{window[-1][0]:04d}-{window[-1][1]:02d}"

    transactions = (
        db.query(models.Transaction)
        .filter(
            models.Transaction.date >= f"{start_prefix}-01",
            models.Transaction.date <= f"{end_prefix}-31",
        )
        .all()
    )

    line_item_ids = {t.line_item_id for t in transactions if t.line_item_id is not None}
    expenses_by_id = {}
    if line_item_ids:
        for e in db.query(models.Expense).filter(models.Expense.id.in_(line_item_ids)).all():
            expenses_by_id[e.id] = e

    # Under FK ON, deleting a bill/fund nulls the tx's pointer (SET NULL) — the
    # spend ledger entry still names the original bucket, so use it to recover the
    # fund id / bill-vs-fund split for orphaned spends.
    tx_ids = [t.id for t in transactions]
    spend_by_tx: dict[int, models.LedgerEntry] = {}
    if tx_ids:
        for e in (
            db.query(models.LedgerEntry)
            .filter(models.LedgerEntry.kind == "spend", models.LedgerEntry.transaction_id.in_(tx_ids))
            .order_by(models.LedgerEntry.id.asc())
            .all()
        ):
            spend_by_tx.setdefault(e.transaction_id, e)

    bill_totals: dict[int, int] = {}         # live bill line_item_id -> cents
    orphan_bill_totals: dict[str, int] = {}  # deleted-bill snapshot name -> cents
    deleted_bill_nameless = 0                # orphan bill with no snapshot name
    fund_totals: dict[int, int] = {}         # fund_id -> cents (live or deleted)
    fund_dest: dict[int, str] = {}           # fund_id -> representative destination snapshot

    for t in transactions:
        line_item = expenses_by_id.get(t.line_item_id) if t.line_item_id is not None else None
        entry = spend_by_tx.get(t.id)
        ledger_fund_id = _fund_id_from_bucket(entry.from_bucket) if entry else None

        # Resolve the fund this spend hit: live pointers first, ledger snapshot last.
        fund_id = None
        if line_item is not None and line_item.type == "fund" and line_item.fund_id is not None:
            fund_id = line_item.fund_id
        elif line_item is None and t.fund_id is not None:
            fund_id = t.fund_id
        elif ledger_fund_id is not None and (line_item is None or line_item.type != "bill"):
            fund_id = ledger_fund_id

        if line_item is not None and line_item.type == "bill":
            bill_totals[line_item.id] = bill_totals.get(line_item.id, 0) + t.amount_cents
        elif fund_id is not None:
            fund_totals[fund_id] = fund_totals.get(fund_id, 0) + t.amount_cents
            if t.destination_type is not None:
                fund_dest.setdefault(fund_id, t.destination_type)
        else:
            # Orphaned bill spend (line item deleted): group by snapshot name.
            name = t.line_item_name
            if name:
                orphan_bill_totals[name] = orphan_bill_totals.get(name, 0) + t.amount_cents
            else:
                deleted_bill_nameless += t.amount_cents

    funds_by_id = {}
    if fund_totals:
        for f in db.query(models.Fund).filter(models.Fund.id.in_(fund_totals)).all():
            funds_by_id[f.id] = f
    deleted_fund_names = _deleted_fund_names(db) if any(fid not in funds_by_id for fid in fund_totals) else {}

    # Bills are month-scoped line items, so the "same" bill (Rent) has a
    # different id in every month's plan — a multi-month window must merge by
    # name (keeping one representative id so the frontend's stable entity
    # colors still work). Single-month keeps pure id grouping.
    if months > 1:
        merged: dict[str, dict] = {}
        for lid, total in bill_totals.items():
            name = expenses_by_id[lid].name
            row = merged.setdefault(name, {"line_item_id": lid, "name": name, "spent_cents": 0})
            row["spent_cents"] += total
        bill_rows = list(merged.values())
    else:
        bill_rows = [
            {"line_item_id": lid, "name": expenses_by_id[lid].name, "spent_cents": total}
            for lid, total in bill_totals.items()
        ]
    # Deleted bills keep their name (owner ruling), grouped by snapshot regardless
    # of window; only truly nameless legacy orphans collapse to "Deleted bill".
    for name, total in orphan_bill_totals.items():
        bill_rows.append({"line_item_id": None, "name": f"{name} (deleted)", "spent_cents": total})
    if deleted_bill_nameless > 0:
        bill_rows.append({"line_item_id": None, "name": "Deleted bill", "spent_cents": deleted_bill_nameless})
    bills = sorted(bill_rows, key=lambda b: b["spent_cents"], reverse=True)

    fund_rows = []
    for fid, total in fund_totals.items():
        if fid in funds_by_id:
            name = funds_by_id[fid].name
            dest = fund_dest.get(fid, funds_by_id[fid].destination_type)
        else:
            base = deleted_fund_names.get(fid)
            name = f"{base} (deleted)" if base else "Deleted fund"
            dest = fund_dest.get(fid, "external_spend")
        fund_rows.append({"fund_id": fid, "name": name, "spent_cents": total, "destination_type": dest})
    funds = sorted(fund_rows, key=lambda f: f["spent_cents"], reverse=True)
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
