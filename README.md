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

- **Funds** hold real money (Savings, Emergency Fund, Vacation, etc.) — total fund balance = total real cash.
- **Expense categories** are monthly budget trackers (Groceries, Rent, etc.) — spending against them deducts from a fund (usually Savings).
- **Transactions** always specify a source fund, and optionally an expense category for budget tracking.
- **Paychecks** add directly to the Savings fund.
- **Transfers** move money between funds.
