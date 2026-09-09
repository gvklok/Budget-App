from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
import schemas
import ledger
from database import get_db

router = APIRouter()


def _fund_id_from_bucket(bucket: Optional[str]) -> Optional[int]:
    if bucket and bucket.startswith("fund:"):
        try:
            return int(bucket.split(":")[1])
        except (ValueError, IndexError):
            return None
    return None


_FUND_DELETED_PREFIX = "Fund deleted: "


def _deleted_fund_names(db: Session) -> dict[int, str]:
    """id -> name for deleted funds, recovered from their deletion ledger entries
    (label 'Fund deleted: {name}', from_bucket 'fund:{id}')."""
    out: dict[int, str] = {}
    for e in (
        db.query(models.LedgerEntry)
        .filter(models.LedgerEntry.label.like(f"{_FUND_DELETED_PREFIX}%"))
        .all()
    ):
        fid = _fund_id_from_bucket(e.from_bucket)
        if fid is not None and e.label:
            out[fid] = e.label[len(_FUND_DELETED_PREFIX):]
    return out


def _snapshot_name_and_destination(tx: models.Transaction, db: Session):
    """At creation time, capture the line item's name and (for fund spends) the
    fund's CURRENT destination_type — so later deletion/reclassification of the
    bill or fund can never rewrite this transaction's history."""
    line_name = None
    destination = None
    if tx.line_item_id is not None:
        line_item = db.query(models.Expense).filter(models.Expense.id == tx.line_item_id).first()
        if line_item is not None:
            line_name = line_item.name
            if line_item.type == "fund" and line_item.fund_id:
                fund = db.query(models.Fund).filter(models.Fund.id == line_item.fund_id).first()
                destination = fund.destination_type if fund else None
    elif tx.fund_id is not None:
        fund = db.query(models.Fund).filter(models.Fund.id == tx.fund_id).first()
        destination = fund.destination_type if fund else None
    return line_name, destination


def _bucket_and_label(tx: models.Transaction, db: Session):
    """Resolve which spendable bucket a transaction hits ('mr' for bill line
    items, 'fund:{id}' for fund line items or direct fund spends) and the label
    to record (merchant, falling back to the line item's name)."""
    bucket = None
    line_name = None
    if tx.line_item_id is not None:
        line_item = db.query(models.Expense).filter(models.Expense.id == tx.line_item_id).first()
        if line_item is not None:
            line_name = line_item.name
            if line_item.type == "bill":
                bucket = "mr"
            elif line_item.type == "fund" and line_item.fund_id:
                bucket = f"fund:{line_item.fund_id}"
    elif tx.fund_id is not None:
        bucket = f"fund:{tx.fund_id}"
    label = tx.merchant or line_name
    return bucket, label


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
            # U9: a Fund tagged allow_negative_balance may go below zero freely.
            if not fund.allow_negative_balance and fund.balance_cents < tx.amount_cents:
                raise HTTPException(
                    400,
                    f"{fund.name} has insufficient funds — need ${tx.amount_cents / 100:.2f}, have ${fund.balance_cents / 100:.2f}",
                )
            fund.balance_cents -= tx.amount_cents
    elif tx.fund_id is not None:
        fund = db.query(models.Fund).filter(models.Fund.id == tx.fund_id).first()
        if not fund:
            raise HTTPException(404, "Fund not found")
        if not fund.allow_negative_balance and fund.balance_cents < tx.amount_cents:
            raise HTTPException(
                400,
                f"{fund.name} has insufficient funds — need ${tx.amount_cents / 100:.2f}, have ${fund.balance_cents / 100:.2f}",
            )
        fund.balance_cents -= tx.amount_cents

    rc.balance_cents -= tx.amount_cents


def _credit_bucket(bucket: Optional[str], amount_cents: int, db: Session) -> bool:
    """Credit `amount_cents` to the named ledger bucket ('mr', 'savings', or
    'fund:{id}'). Returns True if the bucket resolved and was credited, False if
    it no longer exists (a deleted fund) so the caller can follow the money to
    Savings. Does NOT touch Real Cash."""
    if bucket == "mr":
        mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
        mr.balance_cents += amount_cents
        return True
    if bucket == "savings":
        savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
        savings.balance_cents += amount_cents
        return True
    if bucket and bucket.startswith("fund:"):
        try:
            fund_id = int(bucket.split(":")[1])
        except (ValueError, IndexError):
            return False
        fund = db.query(models.Fund).filter(models.Fund.id == fund_id).first()
        if fund:
            fund.balance_cents += amount_cents
            return True
        return False
    return False


def _enrich(transactions: list[models.Transaction], db: Session) -> list[schemas.TransactionOut]:
    """Attach line_item_name and fund_name (resolved through fund-type line
    items too) using one query per lookup table, not per row."""
    line_item_ids = {t.line_item_id for t in transactions if t.line_item_id is not None}
    expenses_by_id = {}
    if line_item_ids:
        for e in db.query(models.Expense).filter(models.Expense.id.in_(line_item_ids)).all():
            expenses_by_id[e.id] = e

    fund_ids = {t.fund_id for t in transactions if t.fund_id is not None}
    for e in expenses_by_id.values():
        if e.type == "fund" and e.fund_id is not None:
            fund_ids.add(e.fund_id)
    funds_by_id = {}
    if fund_ids:
        for f in db.query(models.Fund).filter(models.Fund.id.in_(fund_ids)).all():
            funds_by_id[f.id] = f

    # Fallbacks for deleted buckets: the spend ledger entry (keyed by tx id) still
    # names the fund bucket, and the fund-deletion transfer preserves the name.
    tx_ids = [t.id for t in transactions]
    spend_fund_by_tx: dict[int, int] = {}
    if tx_ids:
        for e in (
            db.query(models.LedgerEntry)
            .filter(models.LedgerEntry.kind == "spend", models.LedgerEntry.transaction_id.in_(tx_ids))
            .order_by(models.LedgerEntry.id.asc())
            .all()
        ):
            if e.transaction_id in spend_fund_by_tx:
                continue
            fid = _fund_id_from_bucket(e.from_bucket)
            if fid is not None:
                spend_fund_by_tx[e.transaction_id] = fid
    deleted_fund_names = _deleted_fund_names(db)

    out = []
    for t in transactions:
        line_item = expenses_by_id.get(t.line_item_id) if t.line_item_id is not None else None
        line_item_name = line_item.name if line_item else t.line_item_name

        fund_name = None
        if t.fund_id is not None:
            fund = funds_by_id.get(t.fund_id)
            fund_name = fund.name if fund else None
        elif line_item is not None and line_item.type == "fund" and line_item.fund_id is not None:
            fund = funds_by_id.get(line_item.fund_id)
            fund_name = fund.name if fund else None
        if fund_name is None:
            # Deleted fund (fund_id / line_item.fund_id nulled): recover via ledger.
            fid = spend_fund_by_tx.get(t.id)
            if fid is not None and fid in deleted_fund_names:
                fund_name = f"{deleted_fund_names[fid]} (deleted)"

        data = schemas.TransactionOut.model_validate(t).model_dump()
        data["line_item_name"] = line_item_name
        data["fund_name"] = fund_name
        data["kind"] = "spend"
        out.append(schemas.TransactionOut(**data))
    return out


def _income_as_transactions(entries: list[models.LedgerEntry]) -> list[schemas.TransactionOut]:
    """Reshape paycheck/misc_income LedgerEntry rows into TransactionOut for the
    combined All Transactions feed. Income isn't tied to a line item or fund, so
    those fields (and destination_type) are always None."""
    out = []
    for e in entries:
        out.append(
            schemas.TransactionOut(
                id=e.id,
                amount_cents=e.amount_cents,
                date=e.date,
                merchant=e.label,
                line_item_id=None,
                fund_id=None,
                line_item_name=None,
                fund_name=None,
                destination_type=None,
                source="manual",
                external_id=None,
                status="posted",
                kind=e.kind,
            )
        )
    return out


@router.get("/", response_model=list[schemas.TransactionOut])
def list_transactions(
    fund_id: Optional[int] = None,
    line_item_id: Optional[int] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    limit: Optional[int] = None,
    include_income: bool = False,
    db: Session = Depends(get_db),
):
    query = db.query(models.Transaction)

    if line_item_id is not None:
        query = query.filter(models.Transaction.line_item_id == line_item_id)

    if fund_id is not None:
        fund_line_item_ids = [
            e.id for e in db.query(models.Expense.id).filter(
                models.Expense.type == "fund", models.Expense.fund_id == fund_id
            ).all()
        ]
        query = query.filter(
            or_(
                models.Transaction.fund_id == fund_id,
                models.Transaction.line_item_id.in_(fund_line_item_ids),
            )
        )

    if year is not None and month is not None:
        prefix = f"{year:04d}-{month:02d}"
        query = query.filter(models.Transaction.date.like(f"{prefix}%"))

    query = query.order_by(models.Transaction.date.desc(), models.Transaction.id.desc())

    transactions = query.all()
    results = _enrich(transactions, db)

    # Income isn't tied to a specific bucket, so a bucket-scoped query (fund_id
    # or line_item_id) always falls back to spend-only, regardless of the flag.
    if include_income and fund_id is None and line_item_id is None:
        income_query = db.query(models.LedgerEntry).filter(
            models.LedgerEntry.kind.in_(["paycheck", "misc_income"])
        )
        if year is not None and month is not None:
            prefix = f"{year:04d}-{month:02d}"
            income_query = income_query.filter(models.LedgerEntry.date.like(f"{prefix}%"))
        income_entries = income_query.all()
        results = results + _income_as_transactions(income_entries)
        results.sort(key=lambda r: r.date, reverse=True)

    if limit is not None:
        results = results[:limit]

    return results


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
    line_name, destination = _snapshot_name_and_destination(tx, db)
    tx.line_item_name = line_name
    tx.destination_type = destination
    _debit(tx, db)
    bucket, label = _bucket_and_label(tx, db)
    ledger.record(
        db,
        kind="spend",
        amount_cents=tx.amount_cents,
        from_bucket=bucket,
        to_bucket="external",
        label=label,
        transaction_id=tx.id,
        date=tx.date,
        destination_type=destination,
    )
    db.commit()
    db.refresh(tx)
    return tx


def _validate_bucket_ref(line_item_id: Optional[int], fund_id: Optional[int], db: Session, what: str):
    """Same XOR-and-exists rule as create_transaction, reused for the split
    endpoint's main leg and every split leg."""
    if line_item_id is None and fund_id is None:
        raise HTTPException(400, f"{what} must provide either line_item_id or fund_id")
    if line_item_id is not None and fund_id is not None:
        raise HTTPException(400, f"{what} must provide only one of line_item_id or fund_id")
    if line_item_id is not None:
        if not db.query(models.Expense).filter(models.Expense.id == line_item_id).first():
            raise HTTPException(404, f"{what}: line item not found")
    if fund_id is not None:
        if not db.query(models.Fund).filter(models.Fund.id == fund_id).first():
            raise HTTPException(404, f"{what}: fund not found")


def _create_leg(
    amount_cents: int,
    date: str,
    merchant: Optional[str],
    line_item_id: Optional[int],
    fund_id: Optional[int],
    db: Session,
) -> models.Transaction:
    """Mirrors create_transaction's per-transaction sequence, minus the commit —
    callers batch-commit once across every leg for atomicity."""
    tx = models.Transaction(
        amount_cents=amount_cents,
        date=date,
        merchant=merchant or None,
        line_item_id=line_item_id,
        fund_id=fund_id,
    )
    db.add(tx)
    db.flush()
    line_name, destination = _snapshot_name_and_destination(tx, db)
    tx.line_item_name = line_name
    tx.destination_type = destination
    _debit(tx, db)
    bucket, label = _bucket_and_label(tx, db)
    ledger.record(
        db,
        kind="spend",
        amount_cents=tx.amount_cents,
        from_bucket=bucket,
        to_bucket="external",
        label=label,
        transaction_id=tx.id,
        date=tx.date,
        destination_type=destination,
    )
    return tx


@router.post("/split")
def create_split_transaction(body: schemas.SplitTransactionCreate, db: Session = Depends(get_db)):
    try:
        date_type.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")
    if body.total_amount_cents <= 0:
        raise HTTPException(400, "Total amount must be positive")

    _validate_bucket_ref(body.main.line_item_id, body.main.fund_id, db, "main")
    for i, split in enumerate(body.splits, start=1):
        if split.amount_cents <= 0:
            raise HTTPException(400, f"Split #{i} amount must be positive")
        _validate_bucket_ref(split.line_item_id, split.fund_id, db, f"split #{i}")

    splits_total = sum(s.amount_cents for s in body.splits)
    if splits_total > body.total_amount_cents:
        raise HTTPException(
            400,
            f"Splits total ${splits_total / 100:.2f}, more than the "
            f"${body.total_amount_cents / 100:.2f} receipt total",
        )
    main_amount_cents = body.total_amount_cents - splits_total

    transactions = []
    if main_amount_cents > 0:
        transactions.append(
            _create_leg(
                main_amount_cents, body.date, body.merchant,
                body.main.line_item_id, body.main.fund_id, db,
            )
        )
    for split in body.splits:
        transactions.append(
            _create_leg(
                split.amount_cents, body.date, split.merchant if split.merchant else body.merchant,
                split.line_item_id, split.fund_id, db,
            )
        )

    db.commit()
    for tx in transactions:
        db.refresh(tx)
    return {"ok": True, "transactions": _enrich(transactions, db)}


@router.delete("/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(models.Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(404, "Transaction not found")

    rc = db.query(models.RealCash).filter(models.RealCash.id == 1).first()

    # Reverse against the ORIGINAL spend's ledger entry, not the tx's current
    # line-item/fund pointers: a since-changed bill->fund type or repointed
    # fund_id would otherwise credit the wrong bucket and corrupt bucket truth.
    spend = (
        db.query(models.LedgerEntry)
        .filter(
            models.LedgerEntry.transaction_id == tx.id,
            models.LedgerEntry.kind == "spend",
        )
        .order_by(models.LedgerEntry.id.asc())
        .first()
    )

    _, derived_label = _bucket_and_label(tx, db)
    if spend is not None:
        origin_bucket = spend.from_bucket
        base_label = spend.label if spend.label is not None else derived_label
    else:
        # Pre-ledger legacy tx: fall back to creation-time derivation.
        origin_bucket, base_label = _bucket_and_label(tx, db)

    # Credit exactly one bucket AND Real Cash by the same amount — that is what
    # preserves the invariant. If the original bucket is a deleted fund, the
    # reversal follows the money to Savings (where the fund's balance was swept).
    suffix = ""
    credited_bucket = origin_bucket
    if origin_bucket is None or not _credit_bucket(origin_bucket, tx.amount_cents, db):
        savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
        savings.balance_cents += tx.amount_cents
        credited_bucket = "savings"
        suffix = " (fund deleted)"

    rc.balance_cents += tx.amount_cents

    if suffix:
        label = f"{base_label}{suffix}" if base_label else suffix.strip()
    else:
        label = base_label

    # Append-only: never delete the original spend entry — record a reversal
    # whose to_bucket is the bucket ACTUALLY credited.
    # Give the reversal the SAME destination snapshot as the original spend so
    # nets stay classified together even after a fund flip or deletion.
    ledger.record(
        db,
        kind="spend_reversal",
        amount_cents=tx.amount_cents,
        from_bucket="external",
        to_bucket=credited_bucket,
        label=label,
        transaction_id=tx.id,
        date=tx.date,
        destination_type=spend.destination_type if spend is not None else None,
    )
    db.delete(tx)
    db.commit()
    return {"ok": True}
