# CLAUDE.md — Budget App

## What this is
A local-only personal budget app: a visual layer over real cash, not a bank replacement.
**Philosophy: saving is the default; spending is intentional.** Unallocated money rests in
Savings. Friction belongs on outflows, never inflows. Honesty over neatness (negative fund
balances are shown red as "Recovering", never hidden; transfer-out money is visibly not
spending). Ambient warnings, not blocking dialogs — the one exception is the mid-month Bill
increase prompt ("where is this coming from?"), which is intentionally blocking.

Canonical docs: `PROJECT.md` (model + UX) and `updates.md` (U1–U9 amendments). When they
conflict with README.md, they win.

## The sacred invariant
```
Real Cash = Savings + Monthly Reserve + Σ Fund balances
```
Must hold after **every** operation. Never patch the invariant by adjusting Real Cash;
find the real bug. The dev overlay displays whether it currently holds.

## Money model (do not reinterpret)
- Three buckets only: **Savings** (default pool), **Monthly Reserve** (one number, no
  sub-categories), **Funds** (roll over by definition).
- Bills route spending to MR; Fund line items / direct fund spends route to that Fund.
  Real Cash drops on every real spend. Internal transfers leave Real Cash unchanged.
- Top-off = move `(target − MR balance)` from Savings; leftover implicitly returns to
  Savings via a smaller next top-off. MR target = Σ current-month Bill amounts.
- Months are independent `MonthlyPlan`s; a new month copies the previous plan once, never
  syncs afterward. Top-off/distribute always act on the *effective current* month
  (`clock.get_current_date`), never the viewed month.
- Funds may opt into negative balances (U9); distribute still sends the flat contribution.
- All money is **cents-as-int**. Never floats.

## Architecture
- `backend/` — FastAPI + SQLAlchemy + SQLite (`data/budget.db`). Routers in
  `backend/routers/`, mounted in `main.py` (which also owns ad-hoc PRAGMA migrations and
  seeding). Month helpers in `plans.py`; effective date in `clock.py`.
- `frontend/` — React 18 + Vite + Tailwind + React Router v6 + Lucide. Pages in
  `src/pages/`, shared primitives in `src/components/ui.jsx`, design tokens in
  `tailwind.config.js` + `src/theme.js`. Charts are hand-rolled SVG — no chart library.
- Dev run: `docker compose -f docker-compose.dev.yml up --build` (frontend :3000,
  backend :8000, Vite proxies `/api`). Backend tests: `cd backend && python -m pytest`.
  Frontend build check: `cd frontend && npx vite build`.
- The Dev Overlay is core Phase 1 infrastructure (testing surface), not a leftover —
  don't remove or env-gate it without asking.

## Orchestration Model
Claude operates here as the **lead orchestrator**: plan, decompose, delegate, review,
integrate. Do not write code line-by-line when a subagent can do it.

**Agent lineup** (`.claude/agents/`):
| Agent | Model | Scope |
|---|---|---|
| `money-core` | opus | Anything that mutates a balance or touches the invariant: transactions, transfers, top-off, distribute, paychecks, ledger, reset, migrations |
| `backend-dev` | sonnet | Read-side backend: reporting/analytics endpoints, filters, schemas, non-money CRUD. Hard boundary: never mutates `balance_cents` |
| `ui-dev` | sonnet | All of `frontend/src`: pages, components, charts, flows, polish |
| `test-writer` | haiku | pytest suites (invariant preservation above all) and mechanical boilerplate |

**Operating rules**
1. Decompose work into independent units; delegate one unit per subagent, right-sizing
   the model (opus only where correctness is critical, haiku for boilerplate/tests).
2. Subagents return concise summaries, never full file dumps — protect context.
3. The orchestrator reviews every diff before integrating and rejects scope creep;
   anything a subagent built beyond its unit spec gets reverted or explicitly adopted.
4. Tests are the quality gate: backend pytest + frontend build must pass before a unit
   is integrated.
5. Token discipline: push reading, boilerplate, and test-writing down to cheaper agents;
   never re-read what's already been summarized; the orchestrator personally reads only
   money-critical diffs and integration points.
6. Pause for the user only on large, destructive, or philosophy-level changes. Everything
   else: use judgment and keep moving. Append changelog entries to `updates.md` as units
   land.

## Conventions
- API money fields end in `_cents`; convert to dollars only at the display boundary.
- Backend "today" must come from `clock.get_current_date(db)` — never `date.today()`.
- HTTP errors carry human-readable dollar amounts in `detail`.
- Frontend reuses `ui.jsx` primitives and `theme.js` tokens; entity colors must be stable
  per id, not per array index.
- Comments only for non-obvious constraints; match surrounding style.
