import re
from datetime import date
from typing import Optional
from pydantic import BaseModel

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class RealCashOut(BaseModel):
    id: int
    balance_cents: int
    model_config = {"from_attributes": True}


class SavingsOut(BaseModel):
    id: int
    balance_cents: int
    model_config = {"from_attributes": True}


class MonthlyReserveOut(BaseModel):
    id: int
    balance_cents: int
    target_cents: int
    model_config = {"from_attributes": True}


class FundOut(BaseModel):
    id: int
    name: str
    balance_cents: int
    monthly_contribution_cents: int
    destination_type: str
    allow_negative_balance: bool
    sort_order: int
    color: Optional[str] = None
    goal_cents: Optional[int] = None
    model_config = {"from_attributes": True}


class FundCreate(BaseModel):
    name: str
    balance_cents: int = 0
    monthly_contribution_cents: int = 0
    destination_type: str = "external_spend"
    allow_negative_balance: bool = False
    color: Optional[str] = None
    goal_cents: Optional[int] = None


class FundUpdate(BaseModel):
    name: Optional[str] = None
    monthly_contribution_cents: Optional[int] = None
    destination_type: Optional[str] = None
    allow_negative_balance: Optional[bool] = None
    color: Optional[str] = None
    goal_cents: Optional[int] = None


class ExpenseCategoryOut(BaseModel):
    id: int
    name: str
    sort_order: int
    model_config = {"from_attributes": True}


class ExpenseCategoryCreate(BaseModel):
    name: str


class ExpenseOut(BaseModel):
    id: int
    name: str
    type: str
    amount_cents: int
    actual_cents: int
    category_id: Optional[int] = None
    fund_id: Optional[int] = None
    plan_id: Optional[int] = None
    sort_order: int
    color: Optional[str] = None
    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    name: str
    type: str = "bill"
    amount_cents: int
    actual_cents: int = 0
    category_id: Optional[int] = None
    fund_id: Optional[int] = None
    new_fund_name: Optional[str] = None  # inline fund creation when type="fund"
    year: Optional[int] = None   # U3: which month's plan this belongs to;
    month: Optional[int] = None  # defaults to the effective current month
    color: Optional[str] = None


class ExpenseUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    amount_cents: Optional[int] = None
    actual_cents: Optional[int] = None
    category_id: Optional[int] = None
    fund_id: Optional[int] = None
    color: Optional[str] = None


class IncomeSourceOut(BaseModel):
    id: int
    name: str
    amount_cents: int
    frequency: str
    anchor_date: Optional[date] = None
    semimonthly_day1: Optional[int] = None
    semimonthly_day2: Optional[int] = None
    next_pay_date: Optional[date] = None  # computed: nearest occurrence on/after "today"
    model_config = {"from_attributes": True}


class IncomeSourceCreate(BaseModel):
    name: str
    amount_cents: int
    frequency: str
    anchor_date: Optional[date] = None
    semimonthly_day1: Optional[int] = None
    semimonthly_day2: Optional[int] = None


class IncomeSourceUpdate(BaseModel):
    name: Optional[str] = None
    amount_cents: Optional[int] = None
    frequency: Optional[str] = None
    anchor_date: Optional[date] = None
    semimonthly_day1: Optional[int] = None
    semimonthly_day2: Optional[int] = None


class TransactionOut(BaseModel):
    id: int
    amount_cents: int
    date: str
    merchant: Optional[str] = None
    line_item_id: Optional[int] = None
    fund_id: Optional[int] = None
    line_item_name: Optional[str] = None
    fund_name: Optional[str] = None
    destination_type: Optional[str] = None
    source: str = "manual"
    external_id: Optional[str] = None
    status: str = "posted"
    model_config = {"from_attributes": True}


class TransactionCreate(BaseModel):
    amount_cents: int
    date: str  # YYYY-MM-DD
    merchant: Optional[str] = None
    line_item_id: Optional[int] = None
    fund_id: Optional[int] = None  # set this OR line_item_id, not both


class LedgerEntryOut(BaseModel):
    id: int
    date: str
    kind: str
    from_bucket: Optional[str] = None
    to_bucket: Optional[str] = None
    amount_cents: int
    label: Optional[str] = None
    transaction_id: Optional[int] = None
    destination_type: Optional[str] = None
    model_config = {"from_attributes": True}


class ChecklistItemOut(BaseModel):
    id: int
    name: str
    is_checked: bool
    model_config = {"from_attributes": True}


class ChecklistItemCreate(BaseModel):
    name: str


class ChecklistItemUpdate(BaseModel):
    name: Optional[str] = None
    is_checked: Optional[bool] = None


class TransferBody(BaseModel):
    from_bucket: str
    to_bucket: str
    amount_cents: int


class StateOut(BaseModel):
    real_cash: RealCashOut
    savings: SavingsOut
    monthly_reserve: MonthlyReserveOut
    funds: list[FundOut]
    invariant_holds: bool
