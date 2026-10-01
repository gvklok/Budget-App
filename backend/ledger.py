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


def fund_contributions_by_month(db: Session, month_prefix: Optional[str] = None) -> dict[str, int]:
    """Net cents moved INTO the pool of all funds (transfer-out funds included — owner
    ruling: a Roth-style fund's allocation leaves Savings like any other; its later
    transfer out is neutral to the savings rate) from outside that pool, per 'YYYY-MM'.
    Ledger-bucket based, any kind except spends/reversals/income: inflows from
    savings/mr/external count +, outflows to non-fund buckets count -. Fund<->fund
    nets to zero and is skipped. month_prefix ('YYYY-MM') filters in SQL."""
    def is_fund(bucket: Optional[str]) -> bool:
        return bool(bucket) and bucket.startswith("fund:")

    q = db.query(models.LedgerEntry).filter(
        ~models.LedgerEntry.kind.in_(["spend", "spend_reversal", "paycheck", "misc_income"])
    )
    if month_prefix:
        q = q.filter(models.LedgerEntry.date.like(f"{month_prefix}%"))
    out: dict[str, int] = {}
    for e in q.all():
        src, dst = is_fund(e.from_bucket), is_fund(e.to_bucket)
        if dst and not src:
            delta = e.amount_cents
        elif src and not dst:
            delta = -e.amount_cents
        else:
            continue
        out[e.date[:7]] = out.get(e.date[:7], 0) + delta
    return out
