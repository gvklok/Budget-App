from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from clock import get_current_date


def get_plan(db: Session, year: int, month: int):
    return (
        db.query(models.MonthlyPlan)
        .filter(models.MonthlyPlan.year == year, models.MonthlyPlan.month == month)
        .first()
    )


def get_or_create_plan(db: Session, year: int, month: int) -> models.MonthlyPlan:
    plan = get_plan(db, year, month)
    if not plan:
        plan = models.MonthlyPlan(year=year, month=month)
        db.add(plan)
        db.flush()
    return plan


def current_year_month(db: Session) -> tuple[int, int]:
    d = get_current_date(db)
    return d.year, d.month


def current_month_bills_total_cents(db: Session) -> int:
    """Sum of Bill line-item amounts for the CURRENT (effective) month's plan —
    used for the Monthly Reserve target. Always the effective current month,
    regardless of which month is being viewed on the Expenses page (U7).

    Flushes first: this runs a raw SQL aggregate (func.sum), which reads
    straight from the database and does not see pending in-session attribute
    changes under autoflush=False — without the flush, a just-edited amount
    would compute against its pre-edit value."""
    db.flush()
    year, month = current_year_month(db)
    plan = get_plan(db, year, month)
    if not plan:
        return 0
    return (
        db.query(func.sum(models.Expense.amount_cents))
        .filter(models.Expense.plan_id == plan.id, models.Expense.type == "bill")
        .scalar()
        or 0
    )


def sync_mr_target(db: Session) -> None:
    """Monthly Reserve's target is always the CURRENT (effective) month's Bills
    total (U7) — never the month being viewed on the Expenses page."""
    mr = db.query(models.MonthlyReserve).filter(models.MonthlyReserve.id == 1).first()
    if mr:
        mr.target_cents = current_month_bills_total_cents(db)


def get_or_autoload_plan(db: Session, year: int, month: int) -> models.MonthlyPlan:
    """U4: navigating to a month with no plan yet auto-initializes it — copying
    line items from the most recent PRIOR planned month if one exists, or an
    empty plan otherwise. Copies are independent; editing the new month never
    touches the source month. Only the single nearest prior month is used, even
    across gaps (no retroactive backfill of months in between)."""
    plan = get_plan(db, year, month)
    if plan:
        return plan

    prior = (
        db.query(models.MonthlyPlan)
        .filter(
            (models.MonthlyPlan.year < year)
            | ((models.MonthlyPlan.year == year) & (models.MonthlyPlan.month < month))
        )
        .order_by(models.MonthlyPlan.year.desc(), models.MonthlyPlan.month.desc())
        .first()
    )

    plan = models.MonthlyPlan(year=year, month=month)
    db.add(plan)
    db.flush()

    if prior:
        prior_items = db.query(models.Expense).filter(models.Expense.plan_id == prior.id).all()
        for item in prior_items:
            db.add(models.Expense(
                name=item.name,
                type=item.type,
                amount_cents=item.amount_cents,
                actual_cents=0,
                category_id=item.category_id,
                fund_id=item.fund_id,
                plan_id=plan.id,
                sort_order=item.sort_order,
                color=item.color,
            ))

    db.commit()
    return plan
