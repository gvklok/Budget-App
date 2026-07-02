from typing import Optional
from pydantic import BaseModel


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
    model_config = {"from_attributes": True}


class FundCreate(BaseModel):
    name: str
    balance_cents: int = 0
    monthly_contribution_cents: int = 0


class FundUpdate(BaseModel):
    name: Optional[str] = None
    monthly_contribution_cents: Optional[int] = None


class ExpenseCategoryOut(BaseModel):
    id: int
    name: str
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
    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    name: str
    type: str = "bill"
    amount_cents: int
    actual_cents: int = 0
    category_id: Optional[int] = None
    fund_id: Optional[int] = None
    new_fund_name: Optional[str] = None  # inline fund creation when type="fund"


class ExpenseUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    amount_cents: Optional[int] = None
    actual_cents: Optional[int] = None
    category_id: Optional[int] = None
    fund_id: Optional[int] = None


class IncomeSourceOut(BaseModel):
    id: int
    name: str
    amount_cents: int
    frequency: str
    model_config = {"from_attributes": True}


class IncomeSourceCreate(BaseModel):
    name: str
    amount_cents: int
    frequency: str


class IncomeSourceUpdate(BaseModel):
    name: Optional[str] = None
    amount_cents: Optional[int] = None
    frequency: Optional[str] = None


class TransactionOut(BaseModel):
    id: int
    amount_cents: int
    date: str
    merchant: Optional[str] = None
    line_item_id: Optional[int] = None
    fund_id: Optional[int] = None
    model_config = {"from_attributes": True}


class TransactionCreate(BaseModel):
    amount_cents: int
    date: str  # YYYY-MM-DD
    merchant: Optional[str] = None
    line_item_id: Optional[int] = None
    fund_id: Optional[int] = None  # set this OR line_item_id, not both


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
