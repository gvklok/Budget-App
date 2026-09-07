"""Tests for POST /transactions/split — one receipt total peeled off across
multiple Bills/Funds, remainder auto-computed for the main bucket.

Every test asserts the invariant: real_cash == savings + mr + sum(fund_balances).
"""


def _make_groceries_bill(client, amount_cents=100000):
    r = client.post("/line-items/", json={
        "name": "Groceries",
        "type": "bill",
        "amount_cents": amount_cents,
        "year": 2026,
        "month": 7,
    })
    assert r.status_code == 200
    return r.json()["id"]


def _make_fund(client, name, balance_cents=0, allow_negative_balance=False):
    r = client.post("/funds/", json={
        "name": name,
        "balance_cents": balance_cents,
        "monthly_contribution_cents": 0,
        "allow_negative_balance": allow_negative_balance,
    })
    assert r.status_code == 200
    return r.json()["id"]


def test_split_happy_path_two_legs(client, helpers):
    """Walmart-receipt example: main Bill gets total minus the one peeled-off
    Fund split, sum of legs == receipt total, invariant holds."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    bill_id = _make_groceries_bill(client)
    client.post("/monthly-reserve/top-off")

    fund_id = _make_fund(client, "Gabe's Fund", balance_cents=50000)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Walmart",
        "total_amount_cents": 4676,
        "main": {"line_item_id": bill_id},
        "splits": [
            {"fund_id": fund_id, "amount_cents": 1175},
        ],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    txs = body["transactions"]
    assert len(txs) == 2
    amounts = sorted(t["amount_cents"] for t in txs)
    assert amounts == [1175, 3501]
    assert sum(t["amount_cents"] for t in txs) == 4676

    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["balance_cents"] == 100000 - 3501
    fund = next(f for f in state["funds"] if f["id"] == fund_id)
    assert fund["balance_cents"] == 50000 - 1175
    assert state["real_cash"]["balance_cents"] == 500000 - 4676
    helpers["assert_invariant"](client)


def test_split_multiple_splits(client, helpers):
    """Three splits plus main leg, remainder computed correctly."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})

    fund_a = _make_fund(client, "A", balance_cents=100000)
    fund_b = _make_fund(client, "B", balance_cents=100000)
    fund_c = _make_fund(client, "C", balance_cents=100000)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Target",
        "total_amount_cents": 10000,
        "main": {"fund_id": fund_a},
        "splits": [
            {"fund_id": fund_b, "amount_cents": 2000},
            {"fund_id": fund_c, "amount_cents": 3000},
        ],
    })
    assert r.status_code == 200, r.text
    txs = r.json()["transactions"]
    assert len(txs) == 3
    main_tx = next(t for t in txs if t["fund_id"] == fund_a)
    assert main_tx["amount_cents"] == 5000  # 10000 - 2000 - 3000

    state = helpers["get_state"](client)
    assert next(f for f in state["funds"] if f["id"] == fund_a)["balance_cents"] == 95000
    assert next(f for f in state["funds"] if f["id"] == fund_b)["balance_cents"] == 98000
    assert next(f for f in state["funds"] if f["id"] == fund_c)["balance_cents"] == 97000
    assert state["real_cash"]["balance_cents"] == 500000 - 10000
    helpers["assert_invariant"](client)


def test_split_exact_remainder_zero_skips_main_leg(client, helpers):
    """Splits sum == total: main leg's computed remainder is exactly $0, so no
    zero-amount transaction is created for main — only the split legs exist."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})

    fund_main = _make_fund(client, "Main", balance_cents=100000)
    fund_split = _make_fund(client, "Split", balance_cents=100000)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Costco",
        "total_amount_cents": 5000,
        "main": {"fund_id": fund_main},
        "splits": [
            {"fund_id": fund_split, "amount_cents": 5000},
        ],
    })
    assert r.status_code == 200, r.text
    txs = r.json()["transactions"]
    assert len(txs) == 1
    assert txs[0]["fund_id"] == fund_split
    assert txs[0]["amount_cents"] == 5000

    state = helpers["get_state"](client)
    # Main bucket untouched — no zero-amount transaction, no ledger entry.
    assert next(f for f in state["funds"] if f["id"] == fund_main)["balance_cents"] == 100000
    assert next(f for f in state["funds"] if f["id"] == fund_split)["balance_cents"] == 95000
    assert state["real_cash"]["balance_cents"] == 500000 - 5000
    helpers["assert_invariant"](client)


def test_split_degenerate_no_splits_behaves_like_single_transaction(client, helpers):
    """Empty splits list: whole total goes to main, same as a plain transaction."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Solo", balance_cents=100000)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Solo Store",
        "total_amount_cents": 2500,
        "main": {"fund_id": fund_id},
        "splits": [],
    })
    assert r.status_code == 200, r.text
    txs = r.json()["transactions"]
    assert len(txs) == 1
    assert txs[0]["amount_cents"] == 2500

    state = helpers["get_state"](client)
    assert next(f for f in state["funds"] if f["id"] == fund_id)["balance_cents"] == 97500
    helpers["assert_invariant"](client)


def test_split_exceeds_total_rejected(client, helpers):
    """Splits summing to more than the receipt total: 400, human dollar message,
    no DB writes at all."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_main = _make_fund(client, "Main", balance_cents=100000)
    fund_split = _make_fund(client, "Split", balance_cents=100000)

    before = helpers["get_state"](client)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Overspend Co",
        "total_amount_cents": 4676,
        "main": {"fund_id": fund_main},
        "splits": [
            {"fund_id": fund_split, "amount_cents": 5000},
        ],
    })
    assert r.status_code == 400
    assert "$50.00" in r.json()["detail"]
    assert "$46.76" in r.json()["detail"]

    after = helpers["get_state"](client)
    assert before == after
    helpers["assert_invariant"](client)


def test_split_atomicity_on_partial_failure(client, helpers):
    """One split leg would overdraw a no-negative-balance Fund: the WHOLE
    request must fail (4xx) and NONE of the other legs' balance changes may be
    persisted — the DB must be exactly as it was before the request."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    bill_id = _make_groceries_bill(client, amount_cents=100000)
    client.post("/monthly-reserve/top-off")

    fund_ok = _make_fund(client, "OK Fund", balance_cents=100000)
    fund_short = _make_fund(client, "Short Fund", balance_cents=1000, allow_negative_balance=False)

    before = helpers["get_state"](client)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Big Store",
        "total_amount_cents": 200000,
        "main": {"line_item_id": bill_id},
        "splits": [
            {"fund_id": fund_ok, "amount_cents": 5000},
            # Would need $2000.00 remaining out of $1000.00 available.
            {"fund_id": fund_short, "amount_cents": 194990},
        ],
    })
    assert r.status_code == 400, r.text

    after = helpers["get_state"](client)
    assert before == after, "partial failure leaked balance changes"

    # No transactions at all should reference our funds/bill from this request.
    assert all(
        t.get("fund_id") not in (fund_ok, fund_short) and t.get("line_item_id") != bill_id
        for t in client.get("/transactions/").json()
    )
    helpers["assert_invariant"](client)


def test_split_missing_line_item_rejected(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Main", balance_cents=100000)
    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Store",
        "total_amount_cents": 1000,
        "main": {"line_item_id": 999999},
        "splits": [],
    })
    assert r.status_code == 404

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Store",
        "total_amount_cents": 1000,
        "main": {"fund_id": fund_id},
        "splits": [{"fund_id": 999999, "amount_cents": 500}],
    })
    assert r.status_code == 404
    helpers["assert_invariant"](client)


def test_split_main_xor_violation_rejected(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Main", balance_cents=100000)
    bill_id = _make_groceries_bill(client)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Store",
        "total_amount_cents": 1000,
        "main": {"line_item_id": bill_id, "fund_id": fund_id},
        "splits": [],
    })
    assert r.status_code == 400

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Store",
        "total_amount_cents": 1000,
        "main": {},
        "splits": [],
    })
    assert r.status_code == 400


def test_split_bad_date_rejected(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Main", balance_cents=100000)
    r = client.post("/transactions/split", json={
        "date": "not-a-date",
        "total_amount_cents": 1000,
        "main": {"fund_id": fund_id},
        "splits": [],
    })
    assert r.status_code == 400


def test_split_zero_total_rejected(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_id = _make_fund(client, "Main", balance_cents=100000)
    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "total_amount_cents": 0,
        "main": {"fund_id": fund_id},
        "splits": [],
    })
    assert r.status_code == 400


def test_split_per_split_merchant_overrides_shared_merchant(client, helpers):
    """A split can itemize its own description (e.g. 'gum, new toy, climbing
    tape'); a split without one falls back to the shared receipt merchant, and
    main always uses the shared merchant regardless."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_main = _make_fund(client, "Main", balance_cents=100000)
    fund_itemized = _make_fund(client, "Gabe's Fund", balance_cents=100000)
    fund_plain = _make_fund(client, "Plain Fund", balance_cents=100000)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Walmart",
        "total_amount_cents": 10000,
        "main": {"fund_id": fund_main},
        "splits": [
            {"fund_id": fund_itemized, "amount_cents": 3700, "merchant": "gum, new toy, climbing tape"},
            {"fund_id": fund_plain, "amount_cents": 1000},
        ],
    })
    assert r.status_code == 200, r.text
    txs = r.json()["transactions"]

    main_tx = next(t for t in txs if t["fund_id"] == fund_main)
    itemized_tx = next(t for t in txs if t["fund_id"] == fund_itemized)
    plain_tx = next(t for t in txs if t["fund_id"] == fund_plain)

    assert main_tx["merchant"] == "Walmart"
    assert itemized_tx["merchant"] == "gum, new toy, climbing tape"
    assert plain_tx["merchant"] == "Walmart"
    helpers["assert_invariant"](client)


def test_split_zero_amount_split_rejected(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    fund_main = _make_fund(client, "Main", balance_cents=100000)
    fund_split = _make_fund(client, "Split", balance_cents=100000)
    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "total_amount_cents": 1000,
        "main": {"fund_id": fund_main},
        "splits": [{"fund_id": fund_split, "amount_cents": 0}],
    })
    assert r.status_code == 400
