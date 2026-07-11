from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter()


@router.get("/", response_model=list[schemas.LedgerEntryOut])
def list_ledger_entries(
    bucket: Optional[str] = None,
    kind: Optional[str] = None,
    year: Optional[int] = None,
    month: Optional[int] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(models.LedgerEntry)

    if bucket is not None:
        query = query.filter(
            or_(models.LedgerEntry.from_bucket == bucket, models.LedgerEntry.to_bucket == bucket)
        )

    if kind is not None:
        query = query.filter(models.LedgerEntry.kind == kind)

    if year is not None and month is not None:
        prefix = f"{year:04d}-{month:02d}"
        query = query.filter(models.LedgerEntry.date.like(f"{prefix}%"))

    query = query.order_by(models.LedgerEntry.date.desc(), models.LedgerEntry.id.desc())

    if limit is not None:
        query = query.limit(limit)

    return query.all()
