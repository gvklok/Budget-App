"""planned_cents is the amount that carries forward to next month's copy. A
log-time Bill-to-Bill cover is a one-month fix (amount_cents only); deliberate
plan edits (create, PATCH amount, U5 reallocate) set both."""
import os
import tempfile

import pytest
from sqlalchemy import create_engine, text

import main
import models


def _setup(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})
    mk = lambda name, amt: client.post("/line-items/", json={
        "name": name, "type": "bill", "amount_cents": amt, "year": 2026, "month": 7}).json()
    pc, gr = mk("Personal Care", 8000), mk("Groceries", 30000)
    client.post("/monthly-reserve/top-off")
    return pc, gr


def _items(client, month):
    return {i["name"]: i for i in client.get("/line-items/", params={"year": 2026, "month": month}).json()}


def _plan_items(client, month):
    r = client.get(f"/plans/2026/{month}")
    assert r.status_code == 200, r.text
    return {i["name"]: i for i in r.json()["line_items"]}


def test_create_sets_planned(client, helpers):
    pc, gr = _setup(client)
    assert pc["planned_cents"] == pc["amount_cents"] == 8000
    assert gr["planned_cents"] == 30000
    helpers["assert_invariant"](client)


def test_cover_bill_from_bill_does_not_carry_forward(client, helpers):
    pc, gr = _setup(client)
    client.post("/transactions/", json={"date": "2026-07-13", "line_item_id": pc["id"], "amount_cents": 6000})
    before = helpers["get_state"](client)
    r = client.post("/transactions/", json={
        "date": "2026-07-13", "line_item_id": pc["id"], "amount_cents": 5000,
        "cover": {"from_line_item_id": gr["id"]}})
    assert r.status_code == 200, r.text
    jul = _items(client, 7)
    assert (jul["Personal Care"]["amount_cents"], jul["Personal Care"]["planned_cents"]) == (11000, 8000)
    assert (jul["Groceries"]["amount_cents"], jul["Groceries"]["planned_cents"]) == (27000, 30000)
    after = helpers["get_state"](client)
    assert after["monthly_reserve"]["target_cents"] == before["monthly_reserve"]["target_cents"] == 38000
    helpers["assert_invariant"](client)

    aug = _plan_items(client, 8)
    assert (aug["Personal Care"]["amount_cents"], aug["Personal Care"]["planned_cents"]) == (8000, 8000)
    assert (aug["Groceries"]["amount_cents"], aug["Groceries"]["planned_cents"]) == (30000, 30000)
    # The source month keeps its covered amounts.
    jul = _items(client, 7)
    assert jul["Personal Care"]["amount_cents"] == 11000
    helpers["assert_invariant"](client)


def test_patch_amount_carries_forward(client, helpers):
    pc, _ = _setup(client)
    r = client.patch(f"/line-items/{pc['id']}", json={"amount_cents": 9500})
    assert r.status_code == 200, r.text
    assert r.json()["amount_cents"] == r.json()["planned_cents"] == 9500
    aug = _plan_items(client, 8)
    assert aug["Personal Care"]["amount_cents"] == aug["Personal Care"]["planned_cents"] == 9500
    helpers["assert_invariant"](client)


def test_patch_after_cover_resets_planned(client, helpers):
    pc, gr = _setup(client)
    client.post("/transactions/", json={"date": "2026-07-13", "line_item_id": pc["id"], "amount_cents": 9000,
                                        "cover": {"from_line_item_id": gr["id"]}})
    r = client.patch(f"/line-items/{pc['id']}", json={"amount_cents": 12000})
    assert r.json()["amount_cents"] == r.json()["planned_cents"] == 12000
    aug = _plan_items(client, 8)
    assert aug["Personal Care"]["amount_cents"] == 12000
    assert aug["Groceries"]["amount_cents"] == 30000
    helpers["assert_invariant"](client)


def test_reallocate_carries_forward(client, helpers):
    pc, gr = _setup(client)
    client.patch(f"/line-items/{pc['id']}", json={"amount_cents": 10000})
    r = client.post("/line-items/reallocate", json={
        "increased_line_item_id": pc["id"], "decreased_line_item_id": gr["id"], "amount_cents": 2000})
    assert r.status_code == 200, r.text
    assert r.json()["decreased"]["amount_cents"] == r.json()["decreased"]["planned_cents"] == 28000
    aug = _plan_items(client, 8)
    assert aug["Personal Care"]["amount_cents"] == 10000
    assert aug["Groceries"]["amount_cents"] == aug["Groceries"]["planned_cents"] == 28000
    helpers["assert_invariant"](client)


# ── Migration ─────────────────────────────────────────────────────────────────

@pytest.fixture
def scratch_engine(monkeypatch):
    path = os.path.join(tempfile.mkdtemp(), "mig.db")
    eng = create_engine(f"sqlite:///{path}")
    monkeypatch.setattr(main, "engine", eng)
    yield eng
    eng.dispose()


def test_migration_backfills_planned_cents(scratch_engine):
    tables = [t for t in models.Base.metadata.sorted_tables if t.name != "expenses"]
    models.Base.metadata.create_all(scratch_engine, tables=tables)
    with scratch_engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE expenses (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'bill',
                amount_cents INTEGER NOT NULL, actual_cents INTEGER NOT NULL DEFAULT 0,
                category_id INTEGER, fund_id INTEGER, plan_id INTEGER,
                sort_order INTEGER NOT NULL DEFAULT 0, color TEXT)"""))
        conn.execute(text("INSERT INTO monthly_plans (id, year, month) VALUES (1, 2026, 7)"))
        conn.execute(text("""
            INSERT INTO expenses (id, name, type, amount_cents, plan_id, sort_order)
            VALUES (1, 'Rent', 'bill', 150000, 1, 1), (2, 'Food', 'bill', 42000, 1, 2)"""))

    main._migrate()
    main._migrate()  # idempotent

    with scratch_engine.connect() as conn:
        rows = conn.execute(text("SELECT id, amount_cents, planned_cents FROM expenses ORDER BY id")).fetchall()
    assert [tuple(r) for r in rows] == [(1, 150000, 150000), (2, 42000, 42000)]
