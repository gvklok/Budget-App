from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter()


@router.get("/", response_model=list[schemas.ChecklistItemOut])
def list_checklist_items(db: Session = Depends(get_db)):
    return db.query(models.ChecklistItem).order_by(models.ChecklistItem.id).all()


@router.post("/", response_model=schemas.ChecklistItemOut)
def create_checklist_item(body: schemas.ChecklistItemCreate, db: Session = Depends(get_db)):
    if not body.name or not body.name.strip():
        raise HTTPException(400, "Name is required")
    item = models.ChecklistItem(name=body.name.strip(), is_checked=False)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=schemas.ChecklistItemOut)
def update_checklist_item(item_id: int, body: schemas.ChecklistItemUpdate, db: Session = Depends(get_db)):
    item = db.query(models.ChecklistItem).filter(models.ChecklistItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Checklist item not found")
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(400, "Name is required")
        item.name = body.name.strip()
    if body.is_checked is not None:
        item.is_checked = body.is_checked
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}")
def delete_checklist_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.ChecklistItem).filter(models.ChecklistItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Checklist item not found")
    db.delete(item)
    db.commit()
    return {"ok": True}


@router.post("/reset")
def reset_checklist(db: Session = Depends(get_db)):
    db.query(models.ChecklistItem).update({"is_checked": False})
    db.commit()
    return {"ok": True}
