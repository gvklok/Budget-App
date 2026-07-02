# BUILD_INSTRUCTIONS.md — Phase 1 Build Plan

**You are Claude Code. Read `PROJECT.md` first. It is the source of truth for what we're building. This document tells you how and in what order to build it.**

---

## 0. Rules You Must Follow

Read these before doing anything else. They override your defaults.

### Anti-hallucination rules
1. **Do not invent features.** If something isn't in `PROJECT.md` or in the gate's "What to build" list, do not build it.
2. **Do not add fields to data models** beyond what's specified. No `created_at`, `updated_at`, `notes`, `tags`, etc. unless the gate says so.
3. **Do not add authentication, user accounts, or multi-tenancy.** Phase 1 is single-user, local-only.
4. **Do not add tests, CI, linting config, or pre-commit hooks** unless explicitly requested in a gate.
5. **Do not add error pages, 404 handlers, or polish features** unless the gate says so.
6. **If something is unclear or ambiguous, STOP and ask** before building. Do not guess.
7. **Do not "improve" prior gates.** If you notice something you'd refactor, mention it in your gate summary but do not change it without permission.
8. **Use exactly the tech stack in `PROJECT.md`.** No substitutions, no extra libraries.

### Gate discipline
9. **Each gate is one logical step.** Do not combine gates. Do not work ahead.
10. **At the end of every gate**, output:
    - A short summary of what you built (5–10 lines max)
    - The exact verification checklist from the gate, formatted as checkboxes for the user
    - Any assumptions you had to make
    - Anything you noticed but did not do
    - Then **STOP and wait for the user to verify**. Do not start the next gate.
11. **The user will say "proceed to gate N" or similar** to advance. If they describe a bug or change, fix it within the current gate's scope before advancing.

### Reconciliation invariant
12. The invariant `Real Cash = Savings + Monthly Reserve + sum(Fund balances)` must hold after every backend operation. Every gate that touches money must preserve this. The dev overlay (Gate 2) must expose whether it currently holds.

---

## How the Gates Are Organized

- **Stage A — Foundation** (Gates 0–2): scaffold, data models, dev overlay
- **Stage B — Funds page standalone** (Gates 3–8)
- **Stage C — Expenses page standalone** (Gates 9–12)
- **Stage D — Wire Funds and Expenses together** (Gates 13–17)
- **Stage E — Checklist** (Gate 18)

Analytics (the Overview tab) is intentionally not in this plan beyond a stub. We'll address it separately later.

---

# STAGE A — FOUNDATION

## Gate 0: Project Scaffold

**Goal:** A running FastAPI backend, a running Vite + React frontend, talking to each other through Docker Compose.

**What to build:**
- Backend directory with FastAPI, Uvicorn, SQLAlchemy, SQLite, Pydantic
- Frontend directory with Vite + React 18 + Tailwind + React Router v6 + Lucide React
- A single `GET /api/health` endpoint that returns `{"status": "ok"}`
- A single React page at `/` that fetches `/api/health` and displays the result
- `docker-compose.yml` with backend and frontend services
- A separate dev compose config that mounts source for hot reload

**What NOT to build:**
- No data models yet
- No styling beyond Tailwind being available
- No routing beyond the single root route
- No env config beyond what's strictly needed

**Verification checklist:**
- [ ] `docker compose up` brings both services up
- [ ] Frontend at `http://localhost:5173` (or chosen port) renders
- [ ] The page shows `status: ok` from the backend
- [ ] Tailwind class on a test element actually applies a visible style
- [ ] Editing a React file hot-reloads in dev mode

**STOP and wait for user verification.**

---

## Gate 1: Core Data Models

**Goal:** SQLAlchemy models and Pydantic schemas for every bucket type. Read endpoints only.

**What to build:**
- SQLAlchemy models:
  - `Savings` — singleton row, fields: `id`, `balance` (Decimal)
  - `MonthlyReserve` — singleton row, fields: `id`, `balance`, `target`
  - `Fund` — many rows, fields: `id`, `name`, `balance`, `monthly_contribution`
  - `RealCash` — singleton row, fields: `id`, `balance`
- Pydantic schemas matching each model
- Database initialization that creates the tables and seeds: Real Cash = 0, Savings = 0, MR balance = 0, MR target = 0, no Funds
- Read endpoints:
  - `GET /api/state` — returns all of the above in one payload, plus a computed `invariant_holds: bool`
  - `GET /api/funds` — list of Funds

**What NOT to build:**
- No write endpoints yet (the dev overlay in Gate 2 will add those)
- No transactions, no line items, no checklist
- No migrations framework — SQLAlchemy `create_all` is fine

**Verification checklist:**
- [ ] DB file is created on first run
- [ ] `GET /api/state` returns the seeded zeros and `invariant_holds: true`
- [ ] `GET /api/funds` returns `[]`
- [ ] All balances use a precise type (Decimal or cents-as-int), not float

**STOP and wait for user verification.**

---

## Gate 2: Dev Overlay

**Goal:** A floating control panel on every page that can manipulate any value and run any simulation. This is the testing surface for every gate that follows.

**What to build:**
- A floating button (bottom-right corner, fixed position) labeled "Dev" that opens an overlay panel
- The overlay shows current values for Real Cash, Savings, MR balance, MR target, and each Fund's balance, plus a `Invariant: OK / BROKEN` indicator
- Controls in the overlay:
  - Set Real Cash to a value
  - Set Savings balance to a value
  - Set MR balance to a value
  - Set MR target to a value
  - For each Fund: set balance, set monthly_contribution
  - "Reset all data" button (wipes DB and re-seeds zeros)
- Backend endpoints to back each control:
  - `POST /api/dev/set-real-cash`
  - `POST /api/dev/set-savings`
  - `POST /api/dev/set-mr-balance`
  - `POST /api/dev/set-mr-target`
  - `POST /api/dev/set-fund-balance`
  - `POST /api/dev/set-fund-contribution`
  - `POST /api/dev/reset`
- Each setter is a raw override — it does NOT enforce the invariant. The invariant indicator simply reports whether it currently holds.

**What NOT to build:**
- No paycheck simulation yet (Gate 16)
- No transaction simulation yet (Gate 6)
- No top-off or distribute buttons yet (Gates 7, 8)
- No Funds CRUD yet (Gate 4) — the overlay only edits existing Fund records' balances, not create/delete them

**Verification checklist:**
- [ ] Dev button visible on every route
- [ ] Overlay opens, closes, and shows live values
- [ ] Each setter updates the value and persists across page reload
- [ ] Invariant indicator correctly flips to "BROKEN" when, e.g., Savings is set higher than Real Cash
- [ ] "Reset all data" returns the app to seeded zeros

**STOP and wait for user verification.**

---

# STAGE B — FUNDS PAGE (STANDALONE)

## Gate 3: Funds Page (read-only)

**Goal:** A real route at `/funds` that displays the bucket state, pulled from the API.

**What to build:**
- Route `/funds` (and make it the default landing route)
- Page sections:
  - Real Cash total (prominent at top)
  - Savings (with balance)
  - Monthly Reserve (with balance and target)
  - Funds list (each shows name, balance, monthly contribution)
- Add a top nav with: Funds, Expenses, Overview, Checklist (latter two can be empty stubs for now)
- All values fetched from `GET /api/state` and `GET /api/funds`

**What NOT to build:**
- No create/edit/delete UI yet
- No transfer UI yet
- No buttons besides nav

**Verification checklist:**
- [ ] `/funds` renders all sections
- [ ] Values match whatever the dev overlay sets
- [ ] Changing values via dev overlay updates the page (after refetch or refresh)
- [ ] Nav links work; stub pages render at `/expenses`, `/overview`, `/checklist`

**STOP and wait for user verification.**

---

## Gate 4: Fund CRUD

**Goal:** Create, edit, delete Funds from the Funds page.

**What to build:**
- "Add Fund" button on Funds page → opens a form: name, optional initial balance (default 0), optional monthly contribution (default 0)
- Edit button on each Fund → rename, change monthly contribution
- Delete button on each Fund → confirm dialog, then delete
- Backend endpoints:
  - `POST /api/funds` (create)
  - `PATCH /api/funds/{id}` (edit)
  - `DELETE /api/funds/{id}` (delete)
- Creating a Fund with an initial balance > 0 should reduce Savings by that amount (so the invariant holds). If Savings is insufficient, reject with an error.
- Deleting a Fund returns its balance to Savings.

**What NOT to build:**
- No transfer-between-buckets UI yet (Gate 5)

**Verification checklist:**
- [ ] Can create a Fund with name only (balance = 0)
- [ ] Can create a Fund with an initial balance; Savings decreases by that amount
- [ ] Cannot create a Fund with an initial balance greater than Savings
- [ ] Can rename a Fund
- [ ] Can change a Fund's monthly contribution
- [ ] Deleting a Fund returns its balance to Savings
- [ ] Invariant holds after every operation

**STOP and wait for user verification.**

---

## Gate 5: Manual Transfers Between Buckets

**Goal:** Move money between Savings, Monthly Reserve, and any Fund.

**What to build:**
- A "Transfer" UI on the Funds page: pick source bucket, pick destination bucket, enter amount, confirm
- Allowed transfers: Savings ↔ MR, Savings ↔ any Fund, MR ↔ any Fund (allow all directions between any two buckets)
- Backend endpoint: `POST /api/transfer` with `{from: "savings"|"mr"|"fund:{id}", to: same, amount}`
- Reject transfer if source has insufficient balance
- Real Cash does not change (it's an internal move)

**What NOT to build:**
- No transaction logging yet (that's spending)
- No simulated paycheck yet

**Verification checklist:**
- [ ] Can transfer Savings → MR; both balances update; Real Cash unchanged
- [ ] Can transfer Savings → Fund
- [ ] Can transfer Fund → Savings
- [ ] Can transfer MR → Savings
- [ ] Insufficient balance is rejected with a clear error
- [ ] Invariant holds after every transfer

**STOP and wait for user verification.**

---

## Gate 6: Simulated Transactions (Spending)

**Goal:** Subtract money from any bucket as if it were spent in the real world. Both the bucket and Real Cash decrease.

**What to build:**
- Add to the dev overlay: "Simulate Transaction" form with amount, source bucket (MR or any Fund — not Savings; we don't spend from Savings directly), and an optional label
- Backend endpoint: `POST /api/dev/simulate-transaction` with `{bucket, amount, label}`
- Effect: subtract amount from the bucket's balance AND from Real Cash
- Reject if bucket has insufficient balance
- Store a record of simulated transactions in a `simulated_transaction` table (fields: `id`, `bucket_ref`, `amount`, `label`, `created_at`) — this is purely for debugging visibility. Display the last 10 in the overlay.

**What NOT to build:**
- This is NOT the real transaction system — that comes in Gate 12. This is a dev-only spending simulator.
- No categories, no line items.

**Verification checklist:**
- [ ] Can simulate spending from MR; MR and Real Cash both decrease by the same amount
- [ ] Can simulate spending from a Fund; that Fund and Real Cash both decrease
- [ ] Cannot simulate spending from Savings (rejected by UI and backend)
- [ ] Insufficient balance is rejected
- [ ] Invariant holds after every simulated transaction
- [ ] Last 10 simulated transactions show in the overlay

**STOP and wait for user verification.**

---

## Gate 7: Monthly Reserve Target + Top-Off Button

**Goal:** The MR has a target value, and a button refills it to that target from Savings.

**What to build:**
- On the Funds page, MR section gains an editable `target` field (already on the model; this is the UI for it)
- "Top Off Monthly Reserve" button on the Funds page
- Backend endpoint: `POST /api/top-off-mr`
  - Computes `delta = target - current_balance`
  - If `delta <= 0`: no-op, return a status indicating MR already at or above target
  - If `delta > Savings balance`: reject with an error indicating insufficient savings
  - Otherwise: transfer `delta` from Savings to MR
- After clicking, the Funds page should reflect new balances

**What NOT to build:**
- No distribute button yet (Gate 8)
- Don't tie target to Bill line items yet (Gate 15)

**Verification checklist:**
- [ ] Can set MR target
- [ ] Top-Off button transfers exactly `(target - current)` from Savings
- [ ] Top-Off button when MR already at target is a no-op with clear feedback
- [ ] Top-Off button when Savings is insufficient is rejected with a clear error
- [ ] Invariant holds after every top-off

**STOP and wait for user verification.**

---

## Gate 8: Distribute Fund Contributions

**Goal:** A button that runs every Fund's monthly contribution as a Savings → Fund transfer.

**What to build:**
- "Distribute Fund Contributions" button on the Funds page
- Backend endpoint: `POST /api/distribute-funds`
  - For each Fund with `monthly_contribution > 0`, transfer that amount from Savings to the Fund
  - Process in Fund order (by id). If Savings runs out mid-way, stop and return a result describing what got funded and what didn't.
  - Returns a summary: `{funded: [...], skipped: [...], savings_remaining: ...}`
- UI shows the summary in a toast or modal after running

**What NOT to build:**
- Don't auto-run on a schedule
- Don't change where monthly_contribution is configured yet (it stays on the Fund record for now)

**Verification checklist:**
- [ ] Click Distribute → each Fund with a contribution > 0 receives its amount; Savings drops by the total
- [ ] If Savings is insufficient mid-way, distribution stops; partial result is reported clearly
- [ ] Funds with contribution = 0 are skipped
- [ ] Invariant holds after distribution

**STOP and wait for user verification.**

---

# STAGE C — EXPENSES PAGE (STANDALONE)

The Expenses page in this stage is **standalone**: line items track budgets and transactions independently. They do NOT yet affect MR or Fund balances. That wiring happens in Stage D.

## Gate 9: Income Setup + Monthly Projection

**Goal:** Configure paycheck info; project monthly income for the next 12 months. Pure projector — no money actually moves.

**What to build:**
- Income config UI on the Expenses page (collapsible section at the top): `take_home_per_paycheck`, `last_pay_date`
- Frequency is hard-coded biweekly
- Backend models: `IncomeConfig` (singleton)
- Endpoint: `POST /api/income-config` to save, `GET /api/income-config` to read
- Endpoint: `GET /api/income-projection?months=12` returns an array of `{year, month, paycheck_count, projected_income}` for the next 12 months from the current real-world date
- Top of Expenses page shows: "Expected income this month: $X"
- Three-paycheck months should be visually marked in the projection table

**What NOT to build:**
- Do NOT add a paycheck simulator that credits Savings yet (Gate 16)
- No yearly summary yet

**Verification checklist:**
- [ ] Can save income config; persists on reload
- [ ] Expected income this month matches manual math
- [ ] 12-month projection table is correct (manually verify at least 2 three-paycheck months)
- [ ] Real Cash and Savings are not affected by anything in this gate

**STOP and wait for user verification.**

---

## Gate 10: Expense Line Items CRUD

**Goal:** Create, edit, delete line items on the Expenses page, each tagged as Bill or Fund.

**What to build:**
- Models: `LineItem` with fields `id`, `name`, `type` (`"bill"` or `"fund"`), `monthly_amount`, `fund_id` (nullable; required if type is fund)
- "Add Line Item" button on Expenses page → form: name, type, monthly amount, (if Fund) link to an existing Fund OR choose "create new Fund inline" with a name
- Edit and delete UI on each line item
- Backend endpoints: `GET/POST/PATCH/DELETE /api/line-items`
- A Fund-type line item that creates an inline Fund creates a Fund record with `monthly_contribution = monthly_amount` and `balance = 0`
- Validation: a Bill cannot have a `fund_id`; a Fund must have one

**What NOT to build:**
- Do NOT yet sync the line item's `monthly_amount` to the Fund's `monthly_contribution` after creation (Gate 14)
- Do NOT yet have transactions (Gate 12)

**Verification checklist:**
- [ ] Can create a Bill line item with name + amount
- [ ] Can create a Fund line item linked to an existing Fund
- [ ] Can create a Fund line item that creates a new Fund inline
- [ ] Validation errors are clear (Bill with fund_id rejected, Fund without fund_id rejected)
- [ ] Can edit and delete line items

**STOP and wait for user verification.**

---

## Gate 11: Expected Expenses Summary

**Goal:** Top of the Expenses page shows expected income, expected expenses, and expected savings for the current month.

**What to build:**
- Endpoint: `GET /api/monthly-summary` returns:
  - `expected_income` (current month projection)
  - `expected_bills_total` (sum of Bill line items' monthly_amount)
  - `expected_fund_contributions_total` (sum of Fund line items' monthly_amount)
  - `expected_expenses_total` (sum of the above two)
  - `expected_savings` (income − expenses)
- Display all of these prominently at the top of the Expenses page

**What NOT to build:**
- No historical comparison yet
- No charts

**Verification checklist:**
- [ ] All four numbers match manual math
- [ ] Editing a line item amount updates the summary
- [ ] Negative expected savings is shown clearly (not hidden)

**STOP and wait for user verification.**

---

## Gate 12: Transaction Logging on Expenses Tab (standalone)

**Goal:** Log transactions against line items. Track spent / remaining per line item. At this stage transactions DO NOT yet affect MR or Fund balances — they only affect the line item's `current_month_spent`.

**What to build:**
- Model: `Transaction` with fields `id`, `amount`, `date`, `merchant`, `line_item_id`, `created_at`
- "Log Transaction" form: amount, date, merchant, line item (dropdown)
- Each line item row shows: monthly_amount, spent this month, remaining
- Expandable section per line item showing recent transactions
- Endpoints: `GET/POST/DELETE /api/transactions`
- `current_month_spent` on a line item = sum of transactions in the current calendar month for that line item (computed; don't store separately)
- Visual flag (e.g., red text) when `spent > monthly_amount` for any line item

**What NOT to build:**
- Do NOT yet update MR or Fund balances when a transaction is logged. That's Gate 13.
- No editing transactions (delete + recreate is fine for now)

**Verification checklist:**
- [ ] Can log a transaction against any line item
- [ ] Spent and remaining update correctly
- [ ] Overspending is flagged visually
- [ ] Recent transactions appear under their line item
- [ ] MR balance and Fund balances are NOT yet affected by logged transactions
- [ ] Real Cash is NOT yet affected (we'll wire this in Gate 13)

**STOP and wait for user verification.**

---

# STAGE D — WIRE FUNDS AND EXPENSES TOGETHER

**This is the highest-risk stage. Each gate here must be tested carefully — the user has asked for extra-thorough verification.**

## Gate 13: Bill Transactions Hit MR; Fund Transactions Hit the Fund

**Goal:** Logging a transaction now actually moves money out of the system.

**What to build:**
- When a transaction is logged:
  - If the line item is a Bill → subtract amount from Monthly Reserve AND Real Cash
  - If the line item is a Fund → subtract amount from the linked Fund's balance AND Real Cash
- Reject transactions if the source bucket has insufficient balance, with a clear error
- Deleting a transaction reverses the effect (adds back to the bucket and Real Cash)

**What NOT to build:**
- Don't auto-create line items
- Don't auto-top-off MR if it goes low

**Verification checklist:**
- [ ] Logging a Bill transaction reduces MR balance and Real Cash by the amount
- [ ] Logging a Fund transaction reduces that Fund's balance and Real Cash
- [ ] Insufficient MR rejects Bill transactions with clear error
- [ ] Insufficient Fund balance rejects Fund transactions with clear error
- [ ] Deleting a transaction reverses balances correctly
- [ ] Invariant holds after every operation
- [ ] Funds page reflects the new balances after a transaction is logged on Expenses page

**STOP and wait for user verification.**

---

## Gate 14: Fund Line Items as Source of Truth for Monthly Contribution

**Goal:** A Fund line item's `monthly_amount` IS the linked Fund's `monthly_contribution`. They are synced.

**What to build:**
- Editing a Fund line item's `monthly_amount` updates the linked Fund's `monthly_contribution`
- Removing the per-Fund "set monthly contribution" UI from the Funds page (it's now read-only there, sourced from the Expenses line item)
- If a Fund has no linked line item, its `monthly_contribution` is 0 and read-only on the Funds page (or display "No Expense line item for this Fund")
- Deleting a Fund line item sets the linked Fund's `monthly_contribution` to 0 (does NOT delete the Fund itself)

**What NOT to build:**
- Don't auto-delete unlinked Funds
- Don't restrict creating Funds without line items (still allowed via Funds page)

**Verification checklist:**
- [ ] Changing a Fund line item's amount changes the Fund's monthly_contribution
- [ ] Funds page shows monthly_contribution as read-only (or with clear indication it's controlled by Expenses page)
- [ ] Distribute Fund Contributions uses the synced amount
- [ ] Deleting a Fund line item zeroes the Fund's monthly_contribution but keeps the Fund
- [ ] Fund created without a line item shows 0 monthly_contribution

**STOP and wait for user verification.**

---

## Gate 15: Monthly Reserve Target = Sum of Bills

**Goal:** MR target is computed from the sum of all Bill line items, not edited directly.

**What to build:**
- `MR.target` is now computed: `sum(line_item.monthly_amount where type == "bill")`
- Remove direct editing of MR target from the UI (Funds page)
- "Top Off Monthly Reserve" button uses this computed target

**What NOT to build:**
- Don't auto-top-off

**Verification checklist:**
- [ ] Adding a Bill line item increases MR target
- [ ] Editing a Bill line item amount updates MR target
- [ ] Deleting a Bill line item decreases MR target
- [ ] Top-Off button uses the computed target
- [ ] Funds page no longer has an "edit target" field; shows computed value

**STOP and wait for user verification.**

---

## Gate 16: Simulate Paycheck

**Goal:** A button in the dev overlay credits the configured take-home to Savings, increasing Real Cash.

**What to build:**
- "Simulate Paycheck" button in the dev overlay
- Backend endpoint: `POST /api/dev/simulate-paycheck`
  - Reads income config
  - Adds `take_home_per_paycheck` to Savings AND to Real Cash
- A counter or log in the overlay showing how many paychecks have been simulated since last reset

**What NOT to build:**
- No automatic paycheck on a date
- No date-simulation system

**Verification checklist:**
- [ ] Click Simulate Paycheck → Savings and Real Cash both go up by take-home
- [ ] Counter increments
- [ ] Invariant holds
- [ ] If income config not set, button is disabled or returns clear error

**STOP and wait for user verification.**

---

## Gate 17: Full End-to-End Month Simulation

**Goal:** This is a **verification gate, not a build gate.** Walk through a complete month flow to confirm everything reconciles.

**What to do:**
- Do not write new code. Only fix bugs found during the walkthrough.
- The user will run this scenario manually:
  1. Reset all data
  2. Configure income ($X take-home, biweekly)
  3. Create several line items: a few Bills, a few Funds
  4. Simulate 2 paychecks (or however many until Savings is sufficient)
  5. Click "Top Off Monthly Reserve"
  6. Click "Distribute Fund Contributions"
  7. Log several Bill transactions and several Fund transactions
  8. Check the Funds page reflects everything correctly
  9. Check the invariant holds at every step

**Verification checklist:**
- [ ] At each step, Real Cash = Savings + MR + sum(Fund balances)
- [ ] Top-off pulls the right amount from Savings
- [ ] Distribute funds the right amounts to each Fund
- [ ] Bill transactions reduce MR; Fund transactions reduce the right Fund
- [ ] Expected income / expected expenses / expected savings on Expenses page match manual math
- [ ] Funds page and Expenses page agree on all numbers

**STOP and wait for user verification. If bugs are found, fix them only within their original gate's scope and re-verify.**

---

# STAGE E — CHECKLIST

## Gate 18: Checklist Page

**Goal:** A simple monthly recurring checklist.

**What to build:**
- Route `/checklist`
- Model: `ChecklistItem` with `id`, `name`, `is_checked`
- UI: list of items with checkbox each, "Add Item" button, edit/delete
- "Reset for New Month" button that unchecks everything
- Endpoints: standard CRUD plus `POST /api/checklist/reset`

**What NOT to build:**
- No automatic monthly reset
- No reminders or notifications

**Verification checklist:**
- [ ] Can add, edit, delete items
- [ ] Can check and uncheck items
- [ ] Reset button unchecks all
- [ ] State persists across page reloads

**STOP and wait for user verification.**

---

# End of Phase 1

After Gate 18, Phase 1 is complete. Do not start Phase 2 (bank sync), Phase 3 (conversational interface), or the Overview tab analytics without explicit instruction.

When asked to summarize the project, refer to `PROJECT.md` as the source of truth.