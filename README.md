# Budget App (Phase 1)

Local-only budgeting app. Savings is the default resting place for money; spending is intentional.

## Run with Docker (production-style build)

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API docs: http://localhost:8000/docs

## Run with Docker (dev mode, hot reload)

```bash
docker compose -f docker-compose.dev.yml up --build
```

- Frontend: http://localhost:3000 (Vite dev server)
- Backend: http://localhost:8000

## Run without Docker

Backend:
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
mkdir -p data
uvicorn main:app --reload --port 8000
```
(Edit `database.py` to point at `./data/budget.db` instead of `/app/data/budget.db` if running outside Docker.)

Frontend:
```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

## Data model

Canonical docs: `PROJECT.md` (model + UX) and `updates.md` (amendments). Summary:

- Three buckets: **Savings** (default resting place — paychecks land here), **Monthly Reserve** (one number that pre-funds the month's Bills), and **Funds** (goal buckets like Vacation or Emergency; roll over, receive monthly contributions from Savings).
- **Reconciliation invariant** after every operation: `Real Cash = Savings + Monthly Reserve + Σ Fund balances`.
- The **Expenses page** plans each month (independent `MonthlyPlan`s; a new month copies the previous plan once). Bill line items route spending to Monthly Reserve; fund spending routes to that Fund. Real Cash drops on every real spend.
- **Transfers** move money between buckets and never change Real Cash. Every money movement is recorded in an append-only **ledger**, which powers per-fund history and the Overview analytics.
- Funds tagged **transfer-out** (Roth, 401k) still move money normally but are reported separately — moving money to yourself is not spending.

Backend tests: `cd backend && pip install -r requirements-dev.txt && python -m pytest`
