from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
import schemas
import ledger
import plans as plans_lib
from database import get_db
from routers.expenses import _spent_by_item, move_bill_budget

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
    if tx.from_savings:
        # The caller already resolved the withdrawal's own destination tag.
        return None, tx.destination_type
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
    items, 'fund:{id}' for fund line items or direct fund spends, 'savings' for
    Savings Withdrawals) and the label to record (merchant, falling back to the
    line item's name, or "Savings")."""
    bucket = None
    line_name = None
    if tx.from_savings:
        return "savings", tx.merchant or "Savings"
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

    if tx.from_savings:
        # Owner ruling: Savings may never go negative, unlike opted-in Funds.
        savings = db.query(models.Savings).filter(models.Savings.id == 1).first()
        if savings.balance_cents < tx.amount_cents:
            raise HTTPException(
                400,
                f"Savings has insufficient funds — need ${tx.amount_cents / 100:.2f}, have ${savings.balance_cents / 100:.2f}",
            )
        savings.balance_cents -= tx.amount_cents
    elif tx.line_item_id is not None:
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
    spend_fund_by_tx: dict[int, int] = {}
    for tid, e in ledger.live_spend_entries(db, [t.id for t in transactions]).items():
        fid = _fund_id_from_bucket(e.from_bucket)
        if fid is not None:
            spend_fund_by_tx[tid] = fid
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


_SAVINGS_DESTINATIONS = ("external_spend", "transfer_out")


def _validate_bucket_ref(
    line_item_id: Optional[int],
    fund_id: Optional[int],
    from_savings: bool,
    destination_type: Optional[str],
    merchant: Optional[str],
    db: Session,
    what: Optional[str],
) -> Optional[str]:
    """Exactly-one-source-and-exists rule shared by create_transaction, the split
    endpoint's main leg, and every split leg. `merchant` is the leg's EFFECTIVE
    merchant. Returns the resolved destination_type for a Savings Withdrawal
    (None otherwise — fund destinations are snapshotted from the fund)."""
    def err(status: int, msg: str):
        raise HTTPException(status, f"{what}: {msg}" if what else msg[0].upper() + msg[1:])

    sources = sum([line_item_id is not None, fund_id is not None, bool(from_savings)])
    if sources == 0:
        err(400, "must provide one of line_item_id, fund_id, or from_savings")
    if sources > 1:
        err(400, "provide only one of line_item_id, fund_id, or from_savings")
    if line_item_id is not None:
        if not db.query(models.Expense).filter(models.Expense.id == line_item_id).first():
            err(404, "line item not found")
    if fund_id is not None:
        if not db.query(models.Fund).filter(models.Fund.id == fund_id).first():
            err(404, "fund not found")
    if not from_savings:
        if destination_type is not None:
            err(400, "destination_type is only allowed when spending from Savings")
        return None
    # Friction on outflows: a Savings spend must say why.
    if not (merchant and merchant.strip()):
        err(400, "A reason is required when spending from Savings")
    destination = destination_type or "external_spend"
    if destination not in _SAVINGS_DESTINATIONS:
        err(400, "destination_type must be 'external_spend' or 'transfer_out'")
    return destination


def _dollars(cents: int) -> str:
    return f"${cents / 100:,.2f}"


def _overage(body: schemas.TransactionCreate, db: Session):
    """Before anything is flushed: how far this spend would push its Bill past
    the planned amount (net spent this plan-month + amount − planned) or its
    Fund past its balance. Returns (overage_cents, bill, fund) — exactly one of
    bill/fund set when the target resolves, else (0, None, None) and _debit
    reports the problem."""
    if body.line_item_id is not None:
        item = db.query(models.Expense).filter(models.Expense.id == body.line_item_id).first()
        if item.type == "bill":
            plan = (
                db.query(models.MonthlyPlan).filter(models.MonthlyPlan.id == item.plan_id).first()
                if item.plan_id is not None else None
            )
            spent = _spent_by_item(db, plan, [item]).get(item.id, 0) if plan else 0
            return max(0, spent + body.amount_cents - item.amount_cents), item, None
        if item.type == "fund" and item.fund_id:
            fund = db.query(models.Fund).filter(models.Fund.id == item.fund_id).first()
            if fund:
                return max(0, body.amount_cents - fund.balance_cents), None, fund
        return 0, None, None
    if body.fund_id is not None:
        fund = db.query(models.Fund).filter(models.Fund.id == body.fund_id).first()
        return max(0, body.amount_cents - fund.balance_cents), None, fund
    return 0, None, None


def _cover_transfer(db: Session, source, from_bucket: str, dest, to_bucket: str,
                    amount_cents: int, target_name: str, tx_id: int) -> None:
    source.balance_cents -= amount_cents
    dest.balance_cents += amount_cents
    ledger.record(
        db,
        kind="transfer",
        amount_cents=amount_cents,
        from_bucket=from_bucket,
        to_bucket=to_bucket,
        label=f"Cover: {target_name}",
        transaction_id=tx_id,
    )


def _apply_cover(cover: schemas.CoverSource, overage: int, bill, fund, tx_id: int, db: Session) -> str:
    """Move `overage` into the spend's target from the chosen source. Runs
    before _debit, uncommitted, so a failing spend rolls the cover back too.
    Deleting the spend later does NOT undo the cover — it stands like any
    transfer/rebalance. Returns the source's human label."""
    savings = db.query(models.Savings).filter(models.Savings.id == 1).first()

    if bill is not None:
        plan = (
            db.query(models.MonthlyPlan).filter(models.MonthlyPlan.id == bill.plan_id).first()
            if bill.plan_id is not None else None
        )
        if plan is None or (plan.year, plan.month) != plans_lib.current_year_month(db):
            raise HTTPException(400, "Can only cover overspending in the current month")
        if cover.from_fund_id is not None:
            raise HTTPException(400, "A Bill can't be covered from a Fund — pick another Bill or Savings")
        if cover.from_line_item_id is not None:
            src = db.query(models.Expense).filter(models.Expense.id == cover.from_line_item_id).first()
            if not src:
                raise HTTPException(404, "Line item not found")
            if src.type != "bill":
                raise HTTPException(400, "A Bill can only be covered from another Bill or Savings")
            move_bill_budget(db, src, bill, overage)
            return src.name
        if savings.balance_cents < overage:
            raise HTTPException(
                400, f"Savings only has {_dollars(savings.balance_cents)} — can't cover {_dollars(overage)}"
            )
        mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
        bill.amount_cents += overage
        _cover_transfer(db, savings, "savings", mr, "mr", overage, bill.name, tx_id)
        plans_lib.sync_mr_target(db)
        return "Savings"

    if cover.from_line_item_id is not None:
        raise HTTPException(400, "A Fund can't be covered from a Bill — pick another Fund or Savings")
    if cover.from_fund_id is not None:
        if cover.from_fund_id == fund.id:
            raise HTTPException(400, f"Can't cover {fund.name} from itself")
        src = db.query(models.Fund).filter(models.Fund.id == cover.from_fund_id).first()
        if not src:
            raise HTTPException(404, "Fund not found")
        if src.balance_cents < overage:
            raise HTTPException(
                400, f"{src.name} only has {_dollars(src.balance_cents)} — can't cover {_dollars(overage)}"
            )
        _cover_transfer(db, src, f"fund:{src.id}", fund, f"fund:{fund.id}", overage, fund.name, tx_id)
        return src.name
    # Owner ruling: Savings may never go negative.
    if savings.balance_cents < overage:
        raise HTTPException(
            400, f"Savings only has {_dollars(savings.balance_cents)} — can't cover {_dollars(overage)}"
        )
    _cover_transfer(db, savings, "savings", fund, f"fund:{fund.id}", overage, fund.name, tx_id)
    return "Savings"


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
    savings_destination = _validate_bucket_ref(
        body.line_item_id, body.fund_id, body.from_savings, body.destination_type,
        body.merchant, db, None,
    )
    cover = body.cover
    if cover is not None:
        if body.from_savings:
            raise HTTPException(400, "A Savings Withdrawal can't be covered — it already comes from Savings")
        sources = sum([cover.from_line_item_id is not None, cover.from_fund_id is not None, bool(cover.from_savings)])
        if sources != 1:
            raise HTTPException(400, "cover must name exactly one of from_line_item_id, from_fund_id, or from_savings")
    # Computed before the tx is flushed so its own amount isn't double-counted.
    overage, bill, fund = _overage(body, db) if cover is not None else (0, None, None)

    tx = models.Transaction(
        amount_cents=body.amount_cents,
        date=body.date,
        merchant=body.merchant or None,
        line_item_id=body.line_item_id,
        fund_id=body.fund_id,
        from_savings=body.from_savings,
        destination_type=savings_destination,
    )
    db.add(tx)
    db.flush()
    line_name, destination = _snapshot_name_and_destination(tx, db)
    tx.line_item_name = line_name
    tx.destination_type = destination
    covered_from = None
    if overage > 0:
        covered_from = _apply_cover(cover, overage, bill, fund, tx.id, db)
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
    out = schemas.TransactionOut.model_validate(tx)
    if covered_from is not None:
        out.covered_cents = overage
        out.covered_from = covered_from
    return out


def _create_leg(
    amount_cents: int,
    date: str,
    merchant: Optional[str],
    line_item_id: Optional[int],
    fund_id: Optional[int],
    from_savings: bool,
    savings_destination: Optional[str],
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
        from_savings=from_savings,
        destination_type=savings_destination,
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

    main_destination = _validate_bucket_ref(
        body.main.line_item_id, body.main.fund_id, body.main.from_savings,
        body.main.destination_type, body.merchant, db, "main",
    )
    split_destinations = []
    for i, split in enumerate(body.splits, start=1):
        if split.amount_cents <= 0:
            raise HTTPException(400, f"Split #{i} amount must be positive")
        split_destinations.append(_validate_bucket_ref(
            split.line_item_id, split.fund_id, split.from_savings, split.destination_type,
            split.merchant if split.merchant else body.merchant, db, f"split #{i}",
        ))

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
                body.main.line_item_id, body.main.fund_id,
                body.main.from_savings, main_destination, db,
            )
        )
    # Any leg's _debit may raise (e.g. insufficient Savings) after earlier legs
    # were flushed; nothing is committed until the end, so the request's
    # session teardown rolls every leg back.
    for split, split_destination in zip(body.splits, split_destinations):
        transactions.append(
            _create_leg(
                split.amount_cents, body.date, split.merchant if split.merchant else body.merchant,
                split.line_item_id, split.fund_id,
                split.from_savings, split_destination, db,
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
    # Must be the LIVE spend: a reused tx id also carries a deleted predecessor's
    # already-reversed spend.
    spend = ledger.live_spend_entries(db, [tx.id]).get(tx.id)

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
