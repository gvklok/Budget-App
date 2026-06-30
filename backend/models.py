from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
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


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)


class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    actual_cents = Column(Integer, default=0, nullable=False)
    category_id = Column(Integer, ForeignKey("expense_categories.id", ondelete="SET NULL"), nullable=True)


class IncomeSource(Base):
    __tablename__ = "income_sources"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    frequency = Column(String, nullable=False)  # monthly | semimonthly | biweekly | weekly


class SimulatedTransaction(Base):
    __tablename__ = "simulated_transactions"
    id = Column(Integer, primary_key=True)
    bucket_ref = Column(String, nullable=False)
    amount_cents = Column(Integer, nullable=False)
    label = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
