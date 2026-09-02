from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, Boolean, Index, text
from database import Base


class RealCash(Base):
    __tablename__ = "real_cash"
    id = Column(Integer, primary_key=True)
    balance_cents = Column(Integer, default=0, nullable=False)


class Savings(Base):
    __tablename__ = "savings"
    id = Column(Integer, primary_key=True)
    balance_cents = Column(Integer, default=0, nullable=False)


class MonthlyReserve(Base):
    __tablename__ = "monthly_reserve"
    id = Column(Integer, primary_key=True)
    balance_cents = Column(Integer, default=0, nullable=False)
    target_cents = Column(Integer, default=0, nullable=False)


class Fund(Base):
    __tablename__ = "funds"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    balance_cents = Column(Integer, default=0, nullable=False)
    monthly_contribution_cents = Column(Integer, default=0, nullable=False)
    destination_type = Column(String, default="external_spend", nullable=False)  # "external_spend" | "transfer_out"
    allow_negative_balance = Column(Boolean, default=False, nullable=False)  # U9
    sort_order = Column(Integer, nullable=False, default=0)
    color = Column(String, nullable=True)  # hex like "#5a82c2"; null = app picks automatically
    goal_cents = Column(Integer, nullable=True)  # informational target; progress computed client-side


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)


class MonthlyPlan(Base):
    """A (year, month) that has been planned — line items are scoped to one of
    these (U3). Existence of a row is what distinguishes a planned month from
    an unplanned one."""
    __tablename__ = "monthly_plans"
    id = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)  # 1-12
    top_off_executed_at = Column(DateTime, nullable=True)  # U6
    distribute_executed_at = Column(DateTime, nullable=True)  # U6


class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False, default="bill")  # "bill" | "fund"
    amount_cents = Column(Integer, nullable=False)
    actual_cents = Column(Integer, default=0, nullable=False)
    category_id = Column(Integer, ForeignKey("expense_categories.id", ondelete="SET NULL"), nullable=True)
    fund_id = Column(Integer, ForeignKey("funds.id", ondelete="SET NULL"), nullable=True)
    plan_id = Column(Integer, ForeignKey("monthly_plans.id", ondelete="CASCADE"), nullable=True)  # U3
    sort_order = Column(Integer, nullable=False, default=0)
    color = Column(String, nullable=True)  # hex like "#5a82c2"; null = app picks automatically


class IncomeSource(Base):
    __tablename__ = "income_sources"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    frequency = Column(String, nullable=False)  # monthly | semimonthly | biweekly | weekly
    # Reference point for weekly/biweekly/monthly interval math (nullable: existing
    # rows predate this and are treated as having no schedule until edited).
    anchor_date = Column(Date, nullable=True)
    # Calendar days of month for "semimonthly" only; 31 (or beyond the month's actual
    # length) means "clamp to the last day of that month" (e.g. "15th and last day").
    semimonthly_day1 = Column(Integer, nullable=True)
    semimonthly_day2 = Column(Integer, nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True)
    amount_cents = Column(Integer, nullable=False)
    date = Column(String, nullable=False)  # YYYY-MM-DD
    merchant = Column(String, nullable=True)
    # SET NULL, not CASCADE: deleting a bill/fund never deletes its history (owner
    # ruling). The name/destination snapshots below keep the row self-describing.
    line_item_id = Column(Integer, ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True)
    fund_id = Column(Integer, ForeignKey("funds.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    line_item_name = Column(String, nullable=True)  # snapshot of the line item's name at creation
    destination_type = Column(String, nullable=True)  # snapshot of the fund's destination at spend time; null for bills
    # Bank-sync seam (passive; no API accepts these yet). external_id is the
    # bank/provider's own id; the partial unique index dedupes imported rows
    # while leaving manual rows (external_id NULL) unconstrained.
    source = Column(String, nullable=False, default="manual")  # "manual" | provider name
    external_id = Column(String, nullable=True)
    status = Column(String, nullable=False, default="posted")  # "posted" | "pending" | ...

    __table_args__ = (
        Index(
            "ix_transactions_source_external_id",
            "source",
            "external_id",
            unique=True,
            sqlite_where=text("external_id IS NOT NULL"),
        ),
    )


class AppClock(Base):
    """Singleton. When simulated_date is set, it stands in for 'today' everywhere
    the backend needs the current date — enables testing month-boundary behavior
    without waiting for real time (U2)."""
    __tablename__ = "app_clock"
    id = Column(Integer, primary_key=True)
    simulated_date = Column(String, nullable=True)  # YYYY-MM-DD or None


class LedgerEntry(Base):
    """Immutable, append-only record of every money movement (U-ledger).
    'external' as a bucket means money entering/leaving the system (Real Cash
    changes). Never updated or deleted except by dev reset."""
    __tablename__ = "ledger_entries"
    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    date = Column(String, nullable=False)  # YYYY-MM-DD effective date of the event
    kind = Column(String, nullable=False)
    from_bucket = Column(String, nullable=True)  # "savings" | "mr" | "fund:{id}" | "external"
    to_bucket = Column(String, nullable=True)    # same vocabulary
    amount_cents = Column(Integer, nullable=False)  # always positive
    label = Column(String, nullable=True)
    transaction_id = Column(Integer, nullable=True)  # plain int ref, no FK — must survive tx deletion
    # Snapshot of the fund's destination at spend time (spend / spend_reversal with
    # a fund-side bucket); null for bill/MR/savings movements. Reporting classifies
    # by this so flipping a fund's destination never reclassifies past months.
    destination_type = Column(String, nullable=True)


class ChecklistItem(Base):
    __tablename__ = "checklist_items"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    is_checked = Column(Boolean, default=False, nullable=False)


class SimulatedTransaction(Base):
    __tablename__ = "simulated_transactions"
    id = Column(Integer, primary_key=True)
    bucket_ref = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    label = Column(String, nullable=True)
    # Only meaningful when bucket_ref == "savings" (a Savings Withdrawal, U1) —
    # tags whether the money left your net worth or moved to another owned account.
    destination_type = Column(String, default="external_spend", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
