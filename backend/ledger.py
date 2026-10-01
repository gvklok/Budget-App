from typing import Optional

from sqlalchemy.orm import Session

import models
from clock import get_current_date


def record(
    db: Session,
    *,
    kind: str,
    amount_cents: int,
    from_bucket: Optional[str] = None,
    to_bucket: Optional[str] = None,
    label: Optional[str] = None,
    transaction_id: Optional[int] = None,
    date: Optional[str] = None,
    destination_type: Optional[str] = None,
) -> None:
    """Append an immutable LedgerEntry. amount_cents must be positive; zero-value
    movements are skipped (nothing happened). date defaults to the effective
    'today'; callers pass the transaction's own date where the spec requires it.
    Does NOT commit — the caller commits alongside the balance mutation."""
    if amount_cents == 0:
        return
    if date is None:
        date = get_current_date(db).isoformat()
    db.add(
        models.LedgerEntry(
            date=date,
            kind=kind,
            from_bucket=from_bucket,
            to_bucket=to_bucket,
            amount_cents=amount_cents,
            label=label,
            transaction_id=transaction_id,
            destination_type=destination_type,
        )
    )


def paired_spend_entries(db: Session, tx_ids=None):
    """Yield (entry, origin) for every spend/spend_reversal entry in id order.
    origin is the entry itself for a spend (or an unpaired reversal), and the
    spend a reversal cancels otherwise. Pairing is LIFO per transaction id,
    all-time: SQLite reuses the ids of deleted transactions, so a tx id can have
    stale spend+reversal pairs. A reversal's own to_bucket can name the wrong
    bucket (a since-deleted Fund credits Savings), so classify by the origin."""
    q = db.query(models.LedgerEntry).filter(models.LedgerEntry.kind.in_(["spend", "spend_reversal"]))
    if tx_ids is not None:
        q = q.filter(models.LedgerEntry.transaction_id.in_(list(tx_ids)))
    stacks: dict[int, list[models.LedgerEntry]] = {}
    for e in q.order_by(models.LedgerEntry.id.asc()).all():
        origin = e
        if e.transaction_id is not None:
            stack = stacks.setdefault(e.transaction_id, [])
            if e.kind == "spend":
                stack.append(e)
            elif stack:
                origin = stack.pop()
        yield e, origin


def live_spend_entries(db: Session, tx_ids) -> dict[int, models.LedgerEntry]:
    """tx id -> its live (un-reversed) spend ledger entry."""
    tx_ids = list(tx_ids)
    if not tx_ids:
        return {}
    live: dict[int, list[models.LedgerEntry]] = {}
    for e, origin in paired_spend_entries(db, tx_ids):
        stack = live.setdefault(e.transaction_id, [])
        if e.kind == "spend":
            stack.append(e)
        elif stack:
            stack.pop()
    return {tid: stack[-1] for tid, stack in live.items() if stack}


INITIAL_BALANCE_LABEL = "Initial balance"
FUND_DELETED_LABEL_PREFIX = "Fund deleted: "


def fund_contributions_by_month(db: Session, month_prefix: Optional[str] = None) -> dict[str, dict[str, int]]:
    """Per 'YYYY-MM': {"fund_contributions_cents", "set_aside_from_savings_cents"}.
    Contributions = net non-fund<->fund movement (monthly distributes, later Savings->Fund
    transfers, money moved back out) into any fund, transfer-out funds included.
    Set-aside = a new fund's starting balance and a deleted fund's sweep back: owner
    ruling — setting a fund up (or undoing it) re-earmarks already-saved money and is
    neutral to the savings rate, while any other later move counts. Fund<->fund is skipped; adjustments (dev corrections), spends and
    income are ignored. month_prefix ('YYYY-MM') filters in SQL."""
    def is_fund(bucket: Optional[str]) -> bool:
        return bool(bucket) and bucket.startswith("fund:")

    q = db.query(models.LedgerEntry).filter(
        ~models.LedgerEntry.kind.in_(["adjustment", "spend", "spend_reversal", "paycheck", "misc_income"])
    )
    if month_prefix:
        q = q.filter(models.LedgerEntry.date.like(f"{month_prefix}%"))
    out: dict[str, dict[str, int]] = {}
    for e in q.all():
        src, dst = is_fund(e.from_bucket), is_fund(e.to_bucket)
        if src == dst:
            continue
        row = out.setdefault(e.date[:7], {"fund_contributions_cents": 0, "set_aside_from_savings_cents": 0})
        setup = e.label == INITIAL_BALANCE_LABEL or (e.label or "").startswith(FUND_DELETED_LABEL_PREFIX)
        key = "set_aside_from_savings_cents" if setup else "fund_contributions_cents"
        row[key] += e.amount_cents if dst else -e.amount_cents
    return out
