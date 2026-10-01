"""Pre-AUTOINCREMENT, SQLite reused transactions.id after the max-id row was deleted, and
LedgerEntry.transaction_id is a plain int. Deleting/listing a tx must use its
LIVE spend entry, never a deleted predecessor's already-reversed spend.

transactions is now AUTOINCREMENT so new ids are never reused, but DBs created
before that already hold reused ids in their ledger history. These tests rewind
sqlite_sequence to recreate that legacy state and keep the defense exercised."""
from sqlalchemy import text

import main


def _force_legacy_id_reuse(deleted_id):
    with main.engine.begin() as conn:
        conn.execute(
            text("UPDATE sqlite_sequence SET seq = :s WHERE name = 'transactions'"),
            {"s": deleted_id - 1},
        )


def _setup(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})
    bill = client.post("/line-items/", json={
        "name": "Groceries", "type": "bill", "amount_cents": 30000, "year": 2026, "month": 7}).json()
    client.post("/monthly-reserve/top-off")
    return bill


def _fund(client, name, balance, destination_type="external_spend"):
    f = client.post("/funds/", json={
        "name": name, "monthly_contribution_cents": 0, "destination_type": destination_type}).json()
    r = client.post("/dev/set-fund-balance", json={"fund_id": f["id"], "balance_cents": balance})
    assert r.status_code == 200, r.text
    return f


def _spend(client, **kw):
    r = client.post("/transactions/", json={"date": "2026-07-13", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _fund_bal(state, fid):
    return next(f["balance_cents"] for f in state["funds"] if f["id"] == fid)


def _reversals(client, tx_id):
    entries = client.get("/ledger/", params={"kind": "spend_reversal", "limit": 1000}).json()
    return sorted((e for e in entries if e["transaction_id"] == tx_id), key=lambda e: e["id"])


def test_reused_id_bill_delete_refunds_mr_not_old_fund(client, helpers):
    bill = _setup(client)
    fund = _fund(client, "Roth", 50000, destination_type="transfer_out")
    helpers["assert_invariant"](client)

    old = _spend(client, fund_id=fund["id"], amount_cents=14300)
    assert client.delete(f"/transactions/{old['id']}").status_code == 200
    _force_legacy_id_reuse(old["id"])
    helpers["assert_invariant"](client)

    new = _spend(client, line_item_id=bill["id"], amount_cents=3501)
    assert new["id"] == old["id"], "precondition: SQLite reused the deleted max id"

    listed = next(t for t in client.get("/transactions/").json() if t["id"] == new["id"])
    assert listed["fund_name"] is None

    before = helpers["get_state"](client)
    assert client.delete(f"/transactions/{new['id']}").status_code == 200
    after = helpers["get_state"](client)

    assert after["monthly_reserve"]["balance_cents"] == before["monthly_reserve"]["balance_cents"] + 3501
    assert _fund_bal(after, fund["id"]) == _fund_bal(before, fund["id"]) == 50000
    assert after["savings"] == before["savings"]
    assert after["real_cash"]["balance_cents"] == before["real_cash"]["balance_cents"] + 3501
    helpers["assert_invariant"](client)

    revs = _reversals(client, new["id"])
    assert [(r["to_bucket"], r["amount_cents"], r["destination_type"]) for r in revs] == [
        (f"fund:{fund['id']}", 14300, "transfer_out"),
        ("mr", 3501, None),
    ]


def test_reused_id_savings_withdrawal_delete_refunds_savings(client, helpers):
    _setup(client)
    fund = _fund(client, "Travel", 50000)

    old = _spend(client, fund_id=fund["id"], amount_cents=14300)
    assert client.delete(f"/transactions/{old['id']}").status_code == 200
    _force_legacy_id_reuse(old["id"])

    new = _spend(client, from_savings=True, merchant="Vet", amount_cents=2500,
                 destination_type="transfer_out")
    assert new["id"] == old["id"]

    before = helpers["get_state"](client)
    assert client.delete(f"/transactions/{new['id']}").status_code == 200
    after = helpers["get_state"](client)

    assert after["savings"]["balance_cents"] == before["savings"]["balance_cents"] + 2500
    assert _fund_bal(after, fund["id"]) == 50000
    assert after["monthly_reserve"] == before["monthly_reserve"]
    helpers["assert_invariant"](client)

    rev = _reversals(client, new["id"])[-1]
    assert rev["to_bucket"] == "savings" and rev["amount_cents"] == 2500
    assert rev["destination_type"] == "transfer_out"


def test_reused_id_deleted_old_fund_not_shown_on_new_tx(client, helpers):
    bill = _setup(client)
    fund = _fund(client, "Old Fund", 50000)
    old = _spend(client, fund_id=fund["id"], amount_cents=14300)
    assert client.delete(f"/transactions/{old['id']}").status_code == 200
    _force_legacy_id_reuse(old["id"])
    assert client.delete(f"/funds/{fund['id']}").status_code == 200

    new = _spend(client, line_item_id=bill["id"], amount_cents=3501)
    assert new["id"] == old["id"]
    listed = next(t for t in client.get("/transactions/").json() if t["id"] == new["id"])
    assert listed["fund_name"] is None

    before = helpers["get_state"](client)
    assert client.delete(f"/transactions/{new['id']}").status_code == 200
    after = helpers["get_state"](client)
    assert after["monthly_reserve"]["balance_cents"] == before["monthly_reserve"]["balance_cents"] + 3501
    assert after["savings"] == before["savings"]
    helpers["assert_invariant"](client)
    assert _reversals(client, new["id"])[-1]["to_bucket"] == "mr"


def test_reused_id_with_cover_transfer_ignored(client, helpers):
    """Cover 'transfer' entries carry transaction_id; they must not be mistaken
    for the spend, and deleting the spend leaves the cover standing."""
    bill = _setup(client)
    fund = _fund(client, "Gifts", 10000)
    src = _fund(client, "Car", 10000)

    old = _spend(client, line_item_id=bill["id"], amount_cents=2000)
    assert client.delete(f"/transactions/{old['id']}").status_code == 200
    _force_legacy_id_reuse(old["id"])

    # Overspend the fund, covered from another Fund; reuses the id.
    new = _spend(client, fund_id=fund["id"], amount_cents=15000, cover={"from_fund_id": src["id"]})
    assert new["id"] == old["id"]
    helpers["assert_invariant"](client)

    before = helpers["get_state"](client)
    assert client.delete(f"/transactions/{new['id']}").status_code == 200
    after = helpers["get_state"](client)
    assert _fund_bal(after, fund["id"]) == _fund_bal(before, fund["id"]) + 15000
    assert _fund_bal(after, src["id"]) == _fund_bal(before, src["id"]) == 5000  # cover stands
    assert after["monthly_reserve"] == before["monthly_reserve"]
    assert after["savings"] == before["savings"]
    helpers["assert_invariant"](client)
    assert _reversals(client, new["id"])[-1]["to_bucket"] == f"fund:{fund['id']}"
