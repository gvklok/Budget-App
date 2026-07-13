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
