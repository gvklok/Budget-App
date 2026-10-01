"""Savings Withdrawals: real transactions spent directly from Savings
(from_savings=True). Savings may never go negative; a reason (merchant) is
required. Every test asserts real_cash == savings + mr + sum(fund_balances).
"""


def _make_fund(client, name, balance_cents=0):
    r = client.post("/funds/", json={
        "name": name,
        "balance_cents": balance_cents,
        "monthly_contribution_cents": 0,
    })
    assert r.status_code == 200
    return r.json()["id"]


def _savings_ledger(client, tx_id):
    entries = client.get("/ledger/", params={"bucket": "savings", "limit": 1000}).json()
    return [e for e in entries if e["transaction_id"] == tx_id]


def test_create_and_delete_savings_withdrawal(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    helpers["assert_invariant"](client)

    r = client.post("/transactions/", json={
        "amount_cents": 25050,
        "date": "2026-07-05",
        "merchant": "Vet emergency",
        "from_savings": True,
    })
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["from_savings"] is True
    assert tx["destination_type"] == "external_spend"
    assert tx["line_item_id"] is None and tx["fund_id"] is None

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000 - 25050
    assert state["real_cash"]["balance_cents"] == 100000 - 25050
    helpers["assert_invariant"](client)

    spend = _savings_ledger(client, tx["id"])
    assert len(spend) == 1
    assert spend[0]["kind"] == "spend"
    assert spend[0]["from_bucket"] == "savings"
    assert spend[0]["to_bucket"] == "external"
    assert spend[0]["label"] == "Vet emergency"
    assert spend[0]["destination_type"] == "external_spend"

    listed = client.get("/transactions/").json()
    row = next(t for t in listed if t["id"] == tx["id"])
    assert row["from_savings"] is True
    assert row["fund_name"] is None

    r = client.delete(f"/transactions/{tx['id']}")
    assert r.status_code == 200, r.text
    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 100000
    assert state["real_cash"]["balance_cents"] == 100000
    helpers["assert_invariant"](client)

    reversal = [e for e in _savings_ledger(client, tx["id"]) if e["kind"] == "spend_reversal"]
    assert len(reversal) == 1
    assert reversal[0]["from_bucket"] == "external"
    assert reversal[0]["to_bucket"] == "savings"
    assert reversal[0]["label"] == "Vet emergency"
    assert reversal[0]["destination_type"] == "external_spend"


def test_savings_withdrawal_exact_balance_allowed(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 5000})
    r = client.post("/transactions/", json={
        "amount_cents": 5000, "date": "2026-07-05", "merchant": "All of it", "from_savings": True,
    })
    assert r.status_code == 200, r.text
    assert helpers["get_state"](client)["savings"]["balance_cents"] == 0
    helpers["assert_invariant"](client)


def test_savings_withdrawal_insufficient_rejected_no_writes(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 10000})
    before = helpers["get_state"](client)
    ledger_before = client.get("/ledger/", params={"limit": 1000}).json()

    r = client.post("/transactions/", json={
        "amount_cents": 10001, "date": "2026-07-05", "merchant": "Too much", "from_savings": True,
    })
    assert r.status_code == 400
    assert r.json()["detail"] == "Savings has insufficient funds — need $100.01, have $100.00"

    assert helpers["get_state"](client) == before
    assert client.get("/ledger/", params={"limit": 1000}).json() == ledger_before
    assert client.get("/transactions/").json() == []
    helpers["assert_invariant"](client)


def test_savings_withdrawal_requires_reason(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 10000})
    before = helpers["get_state"](client)
    for merchant in (None, "", "   "):
        body = {"amount_cents": 100, "date": "2026-07-05", "from_savings": True}
        if merchant is not None:
            body["merchant"] = merchant
        r = client.post("/transactions/", json=body)
        assert r.status_code == 400
        assert r.json()["detail"] == "A reason is required when spending from Savings"
    assert helpers["get_state"](client) == before
    assert client.get("/transactions/").json() == []
    helpers["assert_invariant"](client)


def test_exactly_one_source_and_destination_rules(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 10000})
    fund_id = _make_fund(client, "Car", balance_cents=5000)
    base = {"amount_cents": 100, "date": "2026-07-05", "merchant": "X"}

    r = client.post("/transactions/", json={**base, "fund_id": fund_id, "from_savings": True})
    assert r.status_code == 400
    assert "only one of" in r.json()["detail"]

    r = client.post("/transactions/", json=base)
    assert r.status_code == 400
    assert "from_savings" in r.json()["detail"]

    r = client.post("/transactions/", json={**base, "fund_id": fund_id, "destination_type": "transfer_out"})
    assert r.status_code == 400
    assert "only allowed when spending from Savings" in r.json()["detail"]

    r = client.post("/transactions/", json={**base, "from_savings": True, "destination_type": "bogus"})
    assert r.status_code == 400

    assert client.get("/transactions/").json() == []
    helpers["assert_invariant"](client)


def test_savings_withdrawal_transfer_out_stored(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    r = client.post("/transactions/", json={
        "amount_cents": 50000,
        "date": "2026-07-05",
        "merchant": "Roth IRA contribution",
        "from_savings": True,
        "destination_type": "transfer_out",
    })
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["destination_type"] == "transfer_out"
    spend = _savings_ledger(client, tx["id"])
    assert spend[0]["destination_type"] == "transfer_out"
    # Money still moves normally; only reporting treats it differently.
    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == 50000
    assert state["real_cash"]["balance_cents"] == 50000
    helpers["assert_invariant"](client)

    client.delete(f"/transactions/{tx['id']}")
    reversal = [e for e in _savings_ledger(client, tx["id"]) if e["kind"] == "spend_reversal"]
    assert reversal[0]["destination_type"] == "transfer_out"
    helpers["assert_invariant"](client)


def test_split_fund_plus_savings_leg(client, helpers):
    """$1200 repair: $400 from Car Fund, $800 from Savings."""
    client.post("/dev/set-real-cash", json={"balance_cents": 200000})
    car = _make_fund(client, "Car Fund", balance_cents=40000)
    before = helpers["get_state"](client)

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Transmission repair",
        "total_amount_cents": 120000,
        "main": {"fund_id": car},
        "splits": [{"from_savings": True, "amount_cents": 80000}],
    })
    assert r.status_code == 200, r.text
    txs = r.json()["transactions"]
    savings_leg = next(t for t in txs if t["from_savings"])
    fund_leg = next(t for t in txs if not t["from_savings"])
    assert savings_leg["amount_cents"] == 80000
    assert savings_leg["merchant"] == "Transmission repair"
    assert savings_leg["destination_type"] == "external_spend"
    assert fund_leg["amount_cents"] == 40000 and fund_leg["fund_id"] == car

    state = helpers["get_state"](client)
    assert state["savings"]["balance_cents"] == before["savings"]["balance_cents"] - 80000
    assert next(f for f in state["funds"] if f["id"] == car)["balance_cents"] == 0
    assert state["real_cash"]["balance_cents"] == before["real_cash"]["balance_cents"] - 120000
    helpers["assert_invariant"](client)

    for t in txs:
        assert client.delete(f"/transactions/{t['id']}").status_code == 200
    assert helpers["get_state"](client) == before
    helpers["assert_invariant"](client)


def test_split_savings_main_leg_with_transfer_out(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 200000})
    car = _make_fund(client, "Car Fund", balance_cents=40000)
    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Brokerage move",
        "total_amount_cents": 50000,
        "main": {"from_savings": True, "destination_type": "transfer_out"},
        "splits": [{"fund_id": car, "amount_cents": 10000}],
    })
    assert r.status_code == 200, r.text
    savings_leg = next(t for t in r.json()["transactions"] if t["from_savings"])
    assert savings_leg["amount_cents"] == 40000
    assert savings_leg["destination_type"] == "transfer_out"
    helpers["assert_invariant"](client)


def test_split_savings_leg_insufficient_is_atomic(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 50000})
    car = _make_fund(client, "Car Fund", balance_cents=40000)
    # Savings now $100.00 (500 - 400 swept into the fund).
    before = helpers["get_state"](client)
    ledger_before = client.get("/ledger/", params={"limit": 1000}).json()

    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "merchant": "Transmission repair",
        "total_amount_cents": 120000,
        "main": {"fund_id": car},
        "splits": [{"from_savings": True, "amount_cents": 80000}],
    })
    assert r.status_code == 400
    assert "Savings has insufficient funds" in r.json()["detail"]

    assert helpers["get_state"](client) == before
    assert client.get("/ledger/", params={"limit": 1000}).json() == ledger_before
    assert client.get("/transactions/").json() == []
    helpers["assert_invariant"](client)


def test_split_savings_leg_requires_reason(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 200000})
    car = _make_fund(client, "Car Fund", balance_cents=40000)
    before = helpers["get_state"](client)
    r = client.post("/transactions/split", json={
        "date": "2026-07-05",
        "total_amount_cents": 120000,
        "main": {"fund_id": car},
        "splits": [{"from_savings": True, "amount_cents": 80000, "merchant": "  "}],
    })
    assert r.status_code == 400
    assert "A reason is required when spending from Savings" in r.json()["detail"]
    assert helpers["get_state"](client) == before
    assert client.get("/transactions/").json() == []


def _transfer_out(client, merchant, amount, date):
    r = client.post("/transactions/", json={
        "amount_cents": amount, "date": date, "merchant": merchant,
        "from_savings": True, "destination_type": "transfer_out",
    })
    assert r.status_code == 200, r.text


def test_spending_breakdown_savings_transfers_out(client, helpers):
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    _transfer_out(client, "brokerage", 1000, "2026-07-01")
    _transfer_out(client, " Brokerage ", 2000, "2026-07-03")
    _transfer_out(client, "Roth", 5000, "2026-07-02")
    r = client.get("/overview/spending-breakdown", params={"year": 2026, "month": 7})
    body = r.json()
    assert body["savings_transfers_out"] == [
        {"name": "Roth", "amount_cents": 5000},
        {"name": "Brokerage", "amount_cents": 3000},
    ]
    assert body["savings_withdrawals_cents"] == 0
    helpers["assert_invariant"](client)
