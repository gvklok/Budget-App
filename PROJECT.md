# PROJECT.md — Custom Budget App

This document is the source of truth for what we're building and why. It describes the philosophy, mental model, data architecture, and UX. It does **not** describe build order — that's in `BUILD_INSTRUCTIONS.md`.

---

## 1. Core Philosophy

> **Saving is the default. Spending is intentional.**

Unlike apps that require assigning every dollar a job (zero-based budgeting, YNAB-style), any money that isn't intentionally allocated simply remains in **Savings**. Savings is the default resting place for all money.

The app is **not** trying to replace a bank account. It's a visual layer over real cash that lets the user divide money into meaningful virtual buckets while tracking where it goes.

**Non-goals:**
- No "assign every dollar" workflow
- No forced zero-based budgeting
- No cloud, no auth, no bank sync in Phase 1
- No chat interface in Phase 1
- No mobile native apps — mobile-friendly web only

---

## 2. Tech Stack

**Backend**
- FastAPI + Uvicorn
- SQLAlchemy (ORM) + SQLite
- Pydantic for validation

**Frontend**
- React 18 + React Router v6
- Vite (build tool)
- Tailwind CSS
- Lucide React (icons)

**Infrastructure**
- Docker + Docker Compose (separate dev config)

---

## 3. Mental Model

There are exactly **three kinds of buckets** in the system:

| Bucket | Purpose | Behavior |
|---|---|---|
| **Savings** | Default resting place for all money. | Paychecks land here. Funds and Monthly Reserve are filled from here. Whatever isn't allocated stays here. |
| **Monthly Reserve** | Cash-flow smoothing. Pre-funds the month's bills so the user never spends money they haven't been paid yet. | A single number. No internal categories. Gets *topped off* to a target each month. |
| **Funds** | Discretionary or goal-oriented savings (Vacation, Gabe Spending, Emergency, Christmas, etc.). | Receive a *monthly contribution* from Savings. Spending deducts from the Fund's balance. Roll over by definition. |

Plus one number that ties everything together:

- **Real Cash** — the actual total in the user's real bank account(s). For Phase 1 this is a single number. The reconciliation invariant: `Real Cash = Savings + Monthly Reserve + sum(Fund balances)`.

### The crucial distinction: Bills vs. Funds

On the **Expenses tab**, every line item is tagged as one of two types:

- **Bill** — routine living expense. Has a monthly budget. Transactions deduct from Monthly Reserve.
  - Examples: Rent, Utilities, Groceries, Gas, Insurance, Phones, Subscriptions, Medical, Tithe
- **Fund** — discretionary or long-term. Has a monthly contribution amount. Transactions deduct from the linked Fund's balance.
  - Examples: Vacation, Gabe Spending, Amelia Spending, Christmas, Emergency, Roth Set-Aside

**Important:** Monthly Reserve itself has no sub-categories. Bill line items live on the Expenses tab and are *tagged* as Bills, which is how the system knows to route their transactions to Monthly Reserve. The categorization is on the line item, not inside MR.

---

## 4. Data Architecture

### Buckets
- **Savings** — single record, has a `balance`.
- **Monthly Reserve** — single record, has a `balance` and a `target` (the amount it should be filled to each month).
- **Fund** — multiple records, each with `name`, `balance`, `monthly_contribution`.

### Expense Line Items
Each line item has:
- `name`
- `type` — `"bill"` or `"fund"`
- `monthly_amount` — the budget (for Bills) or planned contribution (for Funds)
- `fund_id` — only set if `type == "fund"`; links to a Fund record
- `current_month_spent` — running total of transactions this month

### Transactions
Each transaction has:
- `amount`
- `date`
- `merchant`
- `line_item_id` — which expense line item it's tagged to

The line item's type determines where the money actually comes out of:
- If the line item is a Bill → deducts from Monthly Reserve
- If the line item is a Fund → deducts from that Fund's balance
- In both cases, Real Cash also decreases (money is leaving the system)

### Income
- `take_home_per_paycheck`
- `last_pay_date`
- Frequency is biweekly (hard-coded for Phase 1)

### Checklist Items
- `name`
- `is_checked`
- Reset to unchecked at the start of each month

---

## 5. How Money Flows

1. Paycheck arrives → lands in Savings. (Simulated by a dev overlay button in Phase 1.)
2. "Top Off Monthly Reserve" button — transfers `(MR target − MR current)` from Savings to MR.
3. "Distribute Fund Contributions" button — for each Fund with a `monthly_contribution > 0`, transfer that amount from Savings to the Fund.
4. Anything unallocated stays in Savings.
5. Transactions are logged on the Expenses tab. Each one deducts from MR or a Fund based on its line item type.
6. Every dollar always belongs somewhere. The reconciliation invariant must hold after every operation.

### Why no rollover logic is needed
Because Monthly Reserve gets topped off (not refilled fully) each month, any unspent money simply stays in MR and next month's top-off pulls less from Savings. Net effect: leftover flows back to Savings on its own. Fund balances roll over by definition.

---

## 6. UX — The Four Tabs

### Tab 1: Funds (the Accounting View)

**Question it answers:** *Where is my money currently sitting?*

Shows:
- Real Cash (total)
- Savings (the default pool)
- Monthly Reserve (single number, no breakdown)
- Each Fund (name + balance + monthly contribution)

Actions available here:
- Create / edit / delete Funds
- Manually move money between buckets (Savings ↔ MR, Savings ↔ any Fund)
- Set Monthly Reserve target
- "Top Off Monthly Reserve" button
- "Distribute Fund Contributions" button
- Set per-Fund auto-allocation amount (note: in the wired version, this will be sourced from the Expenses tab's Fund line items)

### Tab 2: Expenses (the Operations View)

**Question it answers:** *What am I planning to spend this month, and how am I doing?*

Top section — projection summary:
- Expected income this month
- Expected total expenses (sum of Bills + sum of Fund contributions)
- Expected savings (income − expenses)

Income config (collapsible):
- Take-home per paycheck
- Last pay date
- 12-month projection table (which months have 3 paychecks)

Line items list — each row shows:
- Name and type tag ("Bill" or "Fund")
- Monthly amount (budget for Bills, contribution for Funds)
- Spent this month
- Remaining
- Recent transactions (expandable)

Actions:
- Create / edit / delete line items (with Bill or Fund type)
- Log a transaction (amount, date, merchant, line item)

### Tab 3: Overview (analytics — Phase 1 stub only)

Out of scope for Phase 1 build effort. Stub page only.

### Tab 4: Checklist

Simple recurring monthly to-do list.
- Add / edit / delete items
- Check / uncheck
- "Reset for new month" button

---

## 7. The Dev Overlay

A floating control panel accessible from every page (e.g., a button in a corner that opens an overlay). It's the testing and simulation surface for Phase 1. It can:

- Set Real Cash directly to any value
- Set Savings balance directly
- Set Monthly Reserve balance directly
- Set any Fund balance directly
- Simulate a paycheck (adds take-home to Savings)
- Simulate a transaction (subtracts from a chosen bucket)
- Trigger "Top Off MR"
- Trigger "Distribute Fund Contributions"
- Reset all data
- Show the reconciliation status (whether the invariant holds)

This overlay is core infrastructure, not a throwaway. Every later verification step depends on it.

---

## 8. Reconciliation Invariant

At all times:

```
Real Cash = Savings + Monthly Reserve + sum(Fund balances)
```

Every backend operation (transfer, top-off, distribute, simulate transaction, simulate paycheck, etc.) must preserve this invariant. The dev overlay should display whether the invariant currently holds — useful as a sanity check during testing.

---

## 9. Out of Scope for Phase 1

- Authentication / user accounts
- Bank sync (Plaid, SimpleFIN)
- Cloud deployment
- Conversational interface
- Multiple bank accounts surfaced separately (Real Cash is one number)
- Calendar-based automatic monthly resets (manual button only)
- Sophisticated analytics on the Overview tab
- Multi-user
- Mobile native apps

These are all explicitly deferred.

---

## 10. Future Phases (reference only)

- **Phase 2:** Read-only bank sync, auth, 2FA, Docker on Raspberry Pi, Tailscale, encrypted backups.
- **Phase 3:** Conversational interface ("Log $42 for groceries", "How much is left in Vacation?").

These are not being built now and should not influence Phase 1 architecture decisions beyond keeping the data model clean.