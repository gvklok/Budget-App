# UPDATES.md — Phase 1 Amendments

This document defines a set of updates to the Phase 1 spec. It amends `PROJECT.md` and adds gates to `BUILD_INSTRUCTIONS.md`. Read the high-level summary first to see what's changing, then follow the gates for the detailed build plan.

The same anti-hallucination rules from `BUILD_INSTRUCTIONS.md` apply: don't invent features, don't add fields not specified, stop and ask if unclear, verify at every gate.

---

## High-Level Summary of Changes

**1. Fund Destination Type.** Each Fund is tagged as either `external_spend` (money leaves your net worth when spent — Vacation, Gabe Spending, Emergency) or `transfer_out` (money moves to another account you own — 401k, Roth, HSA). Same tag applies to Savings Withdrawals. Only affects reporting: transfer-out transactions do not count in "Actual Spending" totals. Money movement and the reconciliation invariant are unchanged.

**2. Month-Scoped Expenses Page.** The Expenses page becomes month-aware. A dropdown at the top selects the month being viewed. Default is the current real-world month. You can navigate to past or future months.

**3. Auto-Load Previous Month's Plan.** When you navigate to a month that has never been planned before, the app copies the previous month's line items as a starting point. You edit freely from there. If the month has already been planned, the existing plan is used and nothing overwrites it. This means a Bill added mid-month propagates to the next month only if the next month is still unplanned.

**4. Date-Aware Dev Overlay.** Add a "simulated current date" override to the dev overlay. When set, the app treats that date as "today" for all month-boundary logic. When cleared, the real system date is used.

**5. Mid-Month Edits Prompt for Source Labeling.** Every mid-month Bill increase (or new Bill added mid-month) triggers a prompt: "Where is this coming from?" Two options: reduce another Bill's budget by the same amount (no actual money moves — MR is one pool, just relabeling), or transfer the delta from Savings to MR (real money moves). Bill decreases show no prompt — money stays in MR and next month's top-off pulls less. Fund edits don't trigger the prompt.

**6. New-Month Banner.** When the (simulated or real) date crosses into a new month and top-off + distribute have not yet been executed for that month, a semi-transparent banner appears at the top of the app: "New month — Top Off Monthly Reserve and Distribute Funds." One click executes both. The existing manual buttons stay in place.

**7. Past Months Are Read-Only With Per-Session Edit Unlock.** Past months display as closed/read-only by default. An Edit button unlocks the month for the current session so corrections and missed transactions can be added. Navigating away or reloading re-locks the month. The current month and future months are always editable without needing to unlock.

**8. Top-Off and Distribute Always Target the Current Month.** These buttons always act on the current real-world (or simulated) month. Viewing August in July does not change what the buttons do. No pre-topping-off for future months.

**9. Optional Negative Balances Per Fund.** Funds can be individually tagged to allow going below zero. When enabled, transactions that would drive the balance negative are allowed. The Fund displays visually as "recovering" (red balance, warning icon, recovery timeline note). Monthly Distribute transfers the standard contribution regardless of balance state — the Fund gradually catches up. Default is false; enable per-Fund based on how forgiving that category should be.

---

## How These Updates Fit Into the Existing Build

These updates are numbered U1–U7 to distinguish them from the original Phase 1 gates. Some update gates modify prior gates; some add new behavior. Where an update touches an existing gate, that gate's original requirements still apply — the update layers on top.

- **U1** (Fund destination type) can be built at any point after Gate 4. Small, self-contained.
- **U2** (date-aware dev overlay) must be built before U3, since U3 depends on being able to simulate a date.
- **U3** (month-scoped Expenses page) is the largest structural change. It replaces the implicit "current month" model established in Gates 10–12 with an explicit month scope.
- **U4** (auto-load previous month) depends on U3.
- **U5** (mid-month edit UX) is a small addition on top of U3.
- **U6** (new-month banner) depends on U2 and U3.
- **U7** (top-off/distribute stay current-month-only) is a clarification, not a build change — but its acceptance criteria should be verified after U3.
- **U8** (past months read-only with edit unlock) depends on U3. Small addition on top of the month-scoped page.
- **U9** (allow-negative Funds) is independent. Can be built any time after U1.

Follow the same stop-and-verify discipline as the original gates.

---

# UPDATE GATES

## Gate U1: Fund Destination Type

**Goal:** Introduce `external_spend` vs `transfer_out` tagging on Funds and Savings Withdrawals. Only affects reporting.

**What to build:**
- Add field `destination_type` to the `Fund` model. Values: `"external_spend"` (default) or `"transfer_out"`.
- Add the same field to any `SavingsWithdrawal` model, with the same default.
- Update the Fund create/edit UI to expose destination type as a labeled toggle or radio. Default to External Spend.
- Update the Fund line item create/edit UI (on Expenses page) to expose destination type when creating an inline Fund.
- Update the monthly summary (`GET /api/monthly-summary`) to compute Actual Spending EXCLUDING transfer-out Fund transactions and transfer-out Savings Withdrawals. Include them in a separate `transfers_out` field.
- Update the Expenses page Actual Spending section to render a "Transfers out (not spending)" subsection, visually separated from Total Spent.
- Transactions against transfer-out Funds still deduct from the Fund balance and Real Cash. Money movement is unchanged.

**What NOT to build:**
- No new philosophies for savings rate calculation. Savings rate math is unchanged.
- No new UI for "moving money to owned accounts" — just the tag on existing transactions.
- Do not automatically infer destination type from Fund name.

**Verification checklist:**
- [ ] New Funds default to External Spend
- [ ] Can change a Fund to Transfer Out in the UI; persists
- [ ] Logging a transaction against a Transfer-Out Fund still reduces Fund balance and Real Cash
- [ ] The transaction appears in the Fund's history normally
- [ ] Monthly summary's "Total Spent" number excludes Transfer-Out transactions
- [ ] Monthly summary displays a separate "Transfers out" section listing those transactions
- [ ] Savings Withdrawals tagged Transfer Out behave the same way (excluded from spending, shown separately)
- [ ] Reconciliation invariant holds after every operation

**STOP and wait for user verification.**

---

## Gate U2: Date-Aware Dev Overlay

**Goal:** Add a simulated "current date" override to the dev overlay. Enables testing month-boundary behavior without waiting for real time.

**What to build:**
- Add to backend: a singleton `AppClock` record with `simulated_date` (nullable date).
- Backend helper function `get_current_date()` returns `AppClock.simulated_date` if set, otherwise `date.today()`. All backend logic that references "today" or "current month" must use this helper.
- Dev overlay UI:
  - Field to set the simulated date (date picker)
  - Button to clear the override (fall back to real system date)
  - Prominent display of the currently-effective "today" so it's obvious when a simulation is active
- Endpoints:
  - `POST /api/dev/set-simulated-date`
  - `POST /api/dev/clear-simulated-date`

**What NOT to build:**
- Do not auto-advance the simulated date. It only changes when explicitly set.
- Do not persist a simulated date across container restarts unless it happens naturally via SQLite. (Fine either way.)
- Do not change any existing "current month" logic yet — that comes in U3. This gate just adds the plumbing.

**Verification checklist:**
- [ ] Can set simulated date to any date; overlay displays it
- [ ] Can clear the override; overlay shows real date again
- [ ] All existing "current month" behavior (income projection's "this month," monthly summary's "this month") reflects the simulated date once set
- [ ] Clearing the override restores real-date behavior

**STOP and wait for user verification.**

---

## Gate U3: Month-Scoped Expenses Page

**Goal:** Replace the implicit "current month" model on the Expenses page with an explicit month selector. Line items and transactions become month-scoped.

**What to build:**

*Data model:*
- Introduce `MonthlyPlan` — a record for each `(year, month)` combination that has been planned.
- Line items become month-scoped: change `LineItem` to include a `plan_id` (or a `(year, month)` pair). Each line item belongs to a specific month.
- Transactions already have a `date` field; use its year/month to determine which plan they belong to for summary purposes.

*Backend:*
- `GET /api/plans/{year}/{month}` returns the plan for that month, including line items and their transactions.
- `POST /api/plans/{year}/{month}` creates a new plan for that month (used implicitly by U4's auto-load).
- Existing `GET /api/monthly-summary` gains a `year` and `month` query param; defaults to current month per the AppClock.
- Existing `GET /api/line-items` and `POST /api/line-items` gain `year` and `month` scope.

*Frontend:*
- Add a month selector at the top of the Expenses page (dropdown or prev/next arrows with a "Jun 2026" label).
- Default view is the current month (per AppClock).
- All line items shown, all transactions shown, and the summary at the top are for the selected month only.
- Changing the month via the selector fetches that month's plan and re-renders.

**What NOT to build:**
- Do not restrict past months from editing. Any month, past or future, is editable.
- Do not implement U4 (auto-load previous month) in this gate. In this gate, navigating to an unplanned month shows an empty state with a "Start planning this month" button that creates an empty plan. U4 replaces that flow.
- Do not touch the Funds page. It stays month-agnostic — always showing current balances.
- Do not change top-off/distribute logic. Those still act on the current month per the AppClock.

**Verification checklist:**
- [ ] Expenses page defaults to current month (respects simulated date if set)
- [ ] Month selector lets you navigate to any past or future month
- [ ] Navigating to a past month shows that month's line items and transactions
- [ ] Navigating to an unplanned future month shows an empty state with "Start planning" button
- [ ] Creating an empty plan for a future month works
- [ ] Editing a line item in one month does not affect other months
- [ ] Logging a transaction dated in a specific month affects only that month's summary
- [ ] Funds page continues to show live current balances regardless of selected month on Expenses page
- [ ] Reconciliation invariant holds

**STOP and wait for user verification.**

---

## Gate U4: Auto-Load Previous Month's Plan

**Goal:** When you navigate to a month that has no plan yet, automatically initialize it with a copy of the most recent prior month's line items.

**What to build:**
- When `GET /api/plans/{year}/{month}` is called for a month that has no plan:
  - Find the most recent prior month that DOES have a plan
  - If found: create a new plan for the requested month, copy all line items from the found plan (name, type, monthly_amount, fund_id, destination_type), return the new plan
  - If none found: create an empty plan and return it
- Copied line items are independent copies. Editing them in the new month does not affect the source month.
- Copied Fund line items keep their `fund_id` link — they point to the same underlying Fund bucket. Only the monthly contribution amount is copied.
- Replace the U3 "Start planning" empty state — plans now auto-initialize on first navigation.

**What NOT to build:**
- Do not copy transactions. Only line items are copied.
- Do not copy the plan retroactively for months in between. If July has a plan and September has no plan, navigating to September copies from July (not from an empty August). Then if the user later navigates to August, August also copies from July.
- Do not "sync" future months when the source month is edited later. Once a future month has been auto-loaded (or manually planned), it is independent.

**Verification checklist:**
- [ ] Navigating to a fresh future month copies line items from the most recent planned month
- [ ] Editing the new month does not affect the source month
- [ ] Fund line items still link to the correct Fund bucket
- [ ] If a Bill is added to July on July 20, and August has never been visited, then visiting August in early August shows the new Bill in August's plan
- [ ] If August was already planned before the Bill was added to July, August is NOT modified — the new Bill only exists in July
- [ ] If no prior planned month exists, the new plan is empty

**STOP and wait for user verification.**

---

## Gate U5: Mid-Month Bill Edits — Source Labeling Prompt

**Goal:** Any mid-month Bill increase (or new Bill added to the current month) triggers a required "where is this coming from?" dialog. Two paths: reduce another Bill (labeling only, no money moves) or transfer from Savings (real money moves). Bill decreases are silent.

**What to build:**

*Trigger conditions:*
- Editing a current-month Bill's `monthly_amount` upward
- Adding a new Bill line item to the current month
- Both trigger the dialog regardless of whether MR has headroom — this is about labeling intent, not about MR capacity
- Editing a current-month Bill's `monthly_amount` downward: no dialog, no prompt, no side effects beyond the amount change
- Editing Fund line items: no dialog
- Editing line items in a future month (not yet the effective current month): no dialog — future months are pure planning

*Dialog UI:*
- Blocking dialog that appears after the user saves the edit
- Header: "Where is the additional $X coming from?"
- Two options presented as clear paths:
  - **Option A: Reduce another Bill this month.** Shows a dropdown of the current month's Bill line items with their current `monthly_amount`. User picks one. On confirm, the selected Bill's amount decreases by the delta atomically with the increase. No money moves. MR balance and MR target both unchanged.
  - **Option B: Transfer from Savings.** On confirm, runs a Savings → MR transfer for the delta. MR target rises by delta; MR balance rises by delta; Savings drops by delta.
- Cancel button reverts the edit.

*Backend:*
- New endpoint: `POST /api/line-items/reallocate` with `{increased_line_item_id, decreased_line_item_id, amount}`. Atomically increases one Bill and decreases another by the same amount. Rejects if the decrease would make the other Bill negative.
- Existing transfer endpoint used for Option B.

**What NOT to build:**
- No "split across multiple Bills" option. Pick one source.
- No automatic suggestion of which Bill to pull from. User chooses.
- No historical log of reallocation reasons beyond the transaction record. (The line item history shows the amount change; that's enough.)
- No dialog for Fund line item changes.
- No dialog for decrease-only edits.

**Verification checklist:**
- [ ] Increasing a Bill mid-month triggers the dialog every time, regardless of MR balance
- [ ] Adding a new Bill mid-month triggers the dialog
- [ ] Selecting "Reduce another Bill" decreases the picked Bill and increases the edited Bill by the same amount, in one atomic operation
- [ ] Reduce-another-Bill does NOT change MR balance, MR target, Real Cash, or Savings
- [ ] Cannot reduce a Bill below zero via this flow
- [ ] Selecting "Transfer from Savings" runs a real Savings → MR transfer for the delta
- [ ] Transfer-from-Savings updates MR target, MR balance, and Savings; Real Cash unchanged
- [ ] Cancel reverts the edit — no changes persist
- [ ] Decreasing a Bill mid-month shows no dialog and just updates the amount
- [ ] Editing Fund line items shows no dialog
- [ ] Editing line items in future months shows no dialog
- [ ] Reconciliation invariant holds after every operation

**STOP and wait for user verification.**

---

## Gate U6: New-Month Banner

**Goal:** When the effective date crosses into a new month and top-off + distribute have not yet been performed for that month, show a banner prompting one-click execution.

**What to build:**
- Backend: track whether top-off has been performed for `(year, month)` and whether distribute has been performed for `(year, month)`. Add `MonthlyExecution` record or fields on `MonthlyPlan`: `top_off_executed_at`, `distribute_executed_at`.
- New endpoint: `GET /api/current-month-status` returns whether top-off and distribute have been performed for the effective current month.
- The existing top-off endpoint records the timestamp on the current month's plan when it runs. Same for distribute.
- Frontend: on every page, check current-month-status. If EITHER top-off OR distribute has not been performed for the effective current month, render a semi-transparent banner at the top:
  - Text: "New month — top off Monthly Reserve and distribute Fund contributions?"
  - Button: "Run both"
  - Clicking runs top-off then distribute in sequence
- Banner disappears once both are done (or is dismissed with an X for that session — see below).
- Existing manual Top-Off and Distribute buttons on the Funds page remain and continue to work independently.

**What NOT to build:**
- Do not auto-execute. The banner is opt-in.
- Do not implement a persistent dismissal. Session-only dismissal via an X is acceptable; on next page load the banner reappears if actions still haven't run. (Reason: forgetting is worse than nagging.)
- Do not show the banner for past or future months — only the effective current month.

**Verification checklist:**
- [ ] With simulated date set to the 1st of a fresh month, banner appears on every page
- [ ] Clicking "Run both" performs top-off then distribute
- [ ] Banner disappears after both actions complete
- [ ] If top-off was already run manually via the Funds page but distribute hasn't, banner still appears (any missing action triggers it)
- [ ] Banner does not appear when viewing past or future months on the Expenses page
- [ ] Reconciliation invariant holds after banner-triggered execution

**STOP and wait for user verification.**

---

## Gate U7: Verification Pass — Top-Off / Distribute Behavior

**Goal:** No new code. Verify that top-off and distribute always act on the current (effective) month, regardless of which month is being viewed on the Expenses page.

**What to do:**
- No build. This is verification only.
- If bugs are found, fix them within the original gate's scope (Gates 7, 8, or U3/U4 as appropriate).

**Verification checklist:**
- [ ] With effective date in July, viewing August on Expenses page → clicking Top-Off from Funds page tops off July's MR target (not August's)
- [ ] With effective date in July, viewing June on Expenses page → clicking Distribute distributes July's Fund contributions (not June's)
- [ ] Top-off target is computed from the CURRENT month's Bill line items, not the viewed month's
- [ ] Distribute uses the CURRENT month's Fund line items for contribution amounts, not the viewed month's

**STOP and wait for user verification.**

---

## Gate U8: Past Months Read-Only With Edit Unlock

**Goal:** Past months display as closed/read-only by default. An Edit button unlocks the month for the current session so corrections can be made. Navigating away or reloading re-locks.

**What to build:**

*Backend:*
- No persistent state change. Read-only is a client-side concept — the backend accepts edits regardless.
- The rationale: locking on the backend adds complexity for no real safety gain (a determined user can always edit; the goal is preventing accidental edits).

*Frontend:*
- When the selected month on the Expenses page is BEFORE the effective current month (per AppClock):
  - Render the page in "read-only mode": grayed background or faded appearance, "Read only" label near the month selector, all edit/add/delete controls hidden or disabled
  - Show an "Edit" button prominently (top-right of the page, near the month selector)
- When "Edit" is clicked:
  - Enter "editing mode" for this month, for this session only
  - Restore normal appearance and controls
  - Show a small "Editing" indicator and a "Done" button to manually re-lock
- Editing mode persists across in-page interactions but resets on:
  - Navigating to a different month
  - Reloading the page
  - Clicking "Done"
- The current month and future months are never in read-only mode. No Edit button appears for them.

*Interaction with U5:*
- If a past month is unlocked for editing and a Bill is increased, does the U5 dialog appear? No. U5 explicitly triggers only on current-month edits. Past-month edits are just corrections — they change the line item's stored amount but don't trigger reallocation prompts. (Rationale: reallocation is a live decision about where money is coming from *now*; a correction to July while it's August isn't a reallocation, it's a fix.)

**What NOT to build:**
- No backend enforcement of read-only. Client-side only.
- No persistent unlock across sessions or page reloads.
- No unlock UI for current or future months (they're never locked).
- No warning dialog before editing a past month. The Edit button click is confirmation enough.
- No audit trail of past-month edits beyond normal transaction/line-item history.

**Verification checklist:**
- [ ] Navigating to a past month shows the page in read-only mode with visible "Read only" label
- [ ] All add/edit/delete/log-transaction controls are hidden or disabled in read-only mode
- [ ] Edit button is visible for past months and only past months
- [ ] Clicking Edit enables all controls; "Editing" indicator appears
- [ ] Editing a past-month Bill increase does NOT trigger the U5 reallocation dialog
- [ ] Navigating away and returning to the same past month re-locks it
- [ ] Reloading the page re-locks any unlocked past month
- [ ] Clicking Done re-locks the month immediately
- [ ] Current month is never in read-only mode; no Edit button visible for it
- [ ] Future months are never in read-only mode; no Edit button visible for them

**STOP and wait for user verification.**

---

## Gate U9: Optional Negative Balances Per Fund

**Goal:** Allow individual Funds to be configured so their balance can drop below zero. When negative, the Fund displays as "recovering" and gradually catches up via normal monthly contributions.

**What to build:**

*Data model:*
- Add field `allow_negative_balance` to the `Fund` model. Boolean, default `false`.

*Backend behavior:*
- When `allow_negative_balance` is `false` (default): transactions that would drive the Fund balance below zero are rejected with a clear error. Same as current behavior.
- When `allow_negative_balance` is `true`: transactions are allowed even if they drive the balance negative. The Fund balance can be any real number.
- Distribute Fund Contributions logic is UNCHANGED. When a Fund is at −$150 with a $200 monthly contribution, distribute transfers the full $200 from Savings, moving the balance from −$150 to +$50. No special-case "pay off deficit first" logic. Same code path for negative and positive Funds.
- Reconciliation invariant still holds when a Fund is negative. Real Cash already dropped when the negative-driving transaction was logged. No adjustment needed elsewhere.
- Manual transfers into a negative Fund (Savings → Fund) work as normal; balance rises by the transferred amount.

*Fund create/edit UI:*
- Expose `allow_negative_balance` as a labeled toggle. Default off.
- Label suggestion: "Allow this Fund to go negative (catches up automatically)"
- Sub-label suggestion: "Useful for discretionary spending Funds like Vacation or personal spending. Not recommended for transfer-out Funds (401k, Roth, HSA) or Emergency."

*Funds page visual treatment when a Fund is negative:*
- Balance rendered in red
- Small warning icon next to the Fund name
- Label near the balance: "Recovering"
- No blocking dialogs, no confirmation prompts, no popups. Awareness only.

*Expenses page Fund line item when negative:*
- Same red balance + warning icon + "Recovering" label
- Extra small line beneath the balance: "At $X/mo, back to $0 in ~N months" where N = `ceil(|balance| / monthly_contribution)`
- If `monthly_contribution` is zero, show "No contribution set — will not recover automatically" instead

*Behavior when a Fund is switched from allow_negative=true to false while currently negative:*
- Allow the switch; do not force the balance to zero first.
- New transactions against the Fund immediately follow the strict rule (cannot drive further negative — since already negative, cannot spend at all until balance recovers to at least the transaction amount).
- Existing negative balance persists and recovers normally via contributions.

**What NOT to build:**
- No Freeze feature. Users self-regulate whether to spend from a negative Fund.
- No "auto-pay-off-deficit-first" logic in distribute. Balance rises by the fixed monthly contribution regardless of sign.
- No warning dialogs when a transaction drives a Fund negative. Just log it.
- No cap on how negative a Fund can go. Trust the user.
- No email/notification when a Fund enters or exits negative state.
- No changes to Bill line items or Monthly Reserve. This feature is Funds-only.

**Verification checklist:**
- [ ] New Funds default to `allow_negative_balance = false`
- [ ] Can toggle `allow_negative_balance` per Fund via the UI
- [ ] With `allow_negative_balance = false`, a transaction that would drive balance below zero is rejected
- [ ] With `allow_negative_balance = true`, a transaction that drives balance below zero is accepted
- [ ] Real Cash and Savings behave correctly: Real Cash drops by the transaction amount as normal
- [ ] Reconciliation invariant holds when a Fund is negative
- [ ] Funds page shows negative balance in red with "Recovering" label and warning icon
- [ ] Expenses page Fund line item shows the recovery timeline note
- [ ] Distribute Fund Contributions transfers the full monthly contribution to a negative Fund (no deficit-first behavior)
- [ ] A Fund at −$150 with $200/mo goes to +$50 after distribute, not to $0
- [ ] Manual Savings → Fund transfers work normally and raise the balance
- [ ] Switching a Fund from allow_negative=true to false while it's negative is allowed; balance stays negative; new spending is blocked until recovery

**STOP and wait for user verification.**

---

# End of Updates

After U7, the update set is complete. Fold into `PROJECT.md` and `BUILD_INSTRUCTIONS.md` as canonical if the user chooses. Otherwise this file remains as an amendment layer on top of the base spec.

---

# Changelog — Orchestrated improvement pass (2026-07-10, branch `fableFun`)

Confirmed-philosophy pass run by the orchestrator with subagents (see `CLAUDE.md` →
Orchestration Model). Everything below is additive; the money model and invariant are
unchanged.

## New: the Ledger
- `LedgerEntry` — append-only record of every money movement (paycheck, transfer,
  top-off, distribute, spend, spend reversal, fund create/delete, dev adjustments).
  Transaction deletion appends a reversal; nothing is ever rewritten.
- Read API: `GET /ledger` (filter by bucket/kind/month), `GET /funds/{id}/detail`
  (all-time activity + balance-over-time series reconstructed from the ledger),
  `GET /overview/monthly`, `GET /overview/spending-breakdown`,
  `GET /overview/balance-series`.

## New: UI
- **Fund detail page** (`/funds/:id`, tap any fund row): balance-over-time chart,
  full activity history (contributions, transfers, spends, reversals), recovery
  projection when negative, quick Transfer / Log-spend actions.
- **Overview page** (was a stub): kept-vs-spent stacked monthly bars with income
  reference, bucket balance trends (savings / MR / funds / Real Cash), per-month
  "where it went" breakdown with transfers-out separated as not-spending.
- **Checklist page** (Gate 18, was never built): full CRUD, tap-to-toggle,
  progress bar, reset-for-new-month.
- Foundation: one shared API client (was 4 hand-rolled copies), error/retry states
  on every load (pages used to hang on "Loading…"), entity colors stable per id
  across pages, transfer modal validates against available balance before submit,
  new-month banner reports what actually happened ("Topped off $X · Distributed $Y
  to N funds") including no-op phrasing.

## Fixed (bugs)
- Reset All Data left `MonthlyPlan` rows behind — stale top-off/distribute
  timestamps suppressed the new-month banner after a reset.
- Monthly summary dropped fund-line-item transactions from Actual Spending (and
  ignored their fund's transfer-out tag).
- Distribute reported only the first fund it couldn't afford; now lists all
  remaining unfunded funds (funding still stops at the first shortfall).
- Top-off/distribute no-op cases ("already at target", "no bills", "no
  contributions") returned 400 errors; now 200 with a `status` field.
- Reallocate refused to reduce a Bill to exactly $0 (spec allows zero).
- `POST /funds/` accepted a negative initial balance, silently breaking the
  invariant — now rejected; funds can only go negative by spending (U9).
- Creating a line item in a never-visited month bypassed the U4 auto-copy and
  left a sparse plan; first touch now initializes the month from the most recent
  prior plan, same as navigating to it.
- Changing/clearing the simulated date now resyncs the MR target immediately.

## New: quality gates
- `backend/tests/` pytest suite (money ops with exact-balance + invariant asserts,
  ledger recording, reporting math, month-boundary semantics). Dev deps in
  `backend/requirements-dev.txt`.
- `.claude/agents/` — money-core (opus), backend-dev, ui-dev (sonnet),
  test-writer (haiku); orchestration rules in `CLAUDE.md`.
- README data-model section rewritten to match `PROJECT.md` (it described a
  pre-build model).