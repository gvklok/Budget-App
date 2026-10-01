"""Cover the overage: POST /transactions/ with `cover` moves the extra into the
spend's Bill/Fund from a chosen source, atomically with the spend."""


def _setup(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})
    mk = lambda name, amt: client.post("/line-items/", json={
        "name": name, "type": "bill", "amount_cents": amt, "year": 2026, "month": 7}).json()
    pc, gr = mk("Personal Care", 8000), mk("Groceries", 30000)
    client.post("/monthly-reserve/top-off")
    return pc, gr


def _fund(client, name, balance, allow_negative=False):
    f = client.post("/funds/", json={
        "name": name, "monthly_contribution_cents": 0, "allow_negative_balance": allow_negative}).json()
    if balance:
        r = client.post("/dev/set-fund-balance", json={"fund_id": f["id"], "balance_cents": balance})
        assert r.status_code == 200, r.text
    return f


def _spend(client, cover=None, **kw):
    body = {"date": "2026-07-13", **kw}
    if cover is not None:
        body["cover"] = cover
    return client.post("/transactions/", json=body)


def _items(client):
    return {i["name"]: i for i in client.get("/line-items/", params={"year": 2026, "month": 7}).json()}


def _fund_bal(state, fid):
    return next(f["balance_cents"] for f in state["funds"] if f["id"] == fid)


def _ledger(client, kind):
    return client.get("/ledger/", params={"kind": kind}).json()


# ── Happy paths ───────────────────────────────────────────────────────────────

def test_bill_from_bill(client, helpers):
    pc, gr = _setup(client)
    _spend(client, line_item_id=pc["id"], amount_cents=6000)
    before = helpers["get_state"](client)
    r = _spend(client, line_item_id=pc["id"], amount_cents=5000, cover={"from_line_item_id": gr["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["covered_cents"] == 3000 and r.json()["covered_from"] == "Groceries"
    items = _items(client)
    assert items["Personal Care"]["amount_cents"] == 11000
    assert items["Groceries"]["amount_cents"] == 27000
    after = helpers["get_state"](client)
    assert after["monthly_reserve"]["target_cents"] == before["monthly_reserve"]["target_cents"] == 38000
    assert after["monthly_reserve"]["balance_cents"] == before["monthly_reserve"]["balance_cents"] - 5000
    assert after["savings"] == before["savings"]
    assert after["real_cash"]["balance_cents"] == before["real_cash"]["balance_cents"] - 5000
    assert _ledger(client, "transfer") == []  # budget-only, no money moved
    helpers["assert_invariant"](client)


def test_bill_from_savings(client, helpers):
    pc, _ = _setup(client)
    before = helpers["get_state"](client)
    r = _spend(client, line_item_id=pc["id"], amount_cents=10000, cover={"from_savings": True})
    assert r.status_code == 200, r.text
    tx = r.json()
    assert tx["covered_cents"] == 2000 and tx["covered_from"] == "Savings"
    assert _items(client)["Personal Care"]["amount_cents"] == 10000
    after = helpers["get_state"](client)
    assert after["monthly_reserve"]["target_cents"] == 40000
    assert after["savings"]["balance_cents"] == before["savings"]["balance_cents"] - 2000
    # MR got +2000 from Savings then -10000 for the spend.
    assert after["monthly_reserve"]["balance_cents"] == before["monthly_reserve"]["balance_cents"] - 8000
    assert after["real_cash"]["balance_cents"] == before["real_cash"]["balance_cents"] - 10000
    [t] = _ledger(client, "transfer")
    assert (t["from_bucket"], t["to_bucket"], t["amount_cents"]) == ("savings", "mr", 2000)
    assert t["label"] == "Cover: Personal Care" and t["transaction_id"] == tx["id"]
    helpers["assert_invariant"](client)


def test_fund_from_fund_direct_spend(client, helpers):
    _setup(client)
    car = _fund(client, "Car", 3000)
    gifts = _fund(client, "Gifts", 5000)
    before = helpers["get_state"](client)
    r = _spend(client, fund_id=car["id"], amount_cents=4500, cover={"from_fund_id": gifts["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["covered_cents"] == 1500 and r.json()["covered_from"] == "Gifts"
    after = helpers["get_state"](client)
    assert _fund_bal(after, car["id"]) == 0
    assert _fund_bal(after, gifts["id"]) == 3500
    assert after["savings"] == before["savings"]
    assert after["monthly_reserve"] == before["monthly_reserve"]
    assert after["real_cash"]["balance_cents"] == before["real_cash"]["balance_cents"] - 4500
    [t] = [e for e in _ledger(client, "transfer") if e["label"] == "Cover: Car"]
    assert (t["from_bucket"], t["to_bucket"], t["amount_cents"]) == (f"fund:{gifts['id']}", f"fund:{car['id']}", 1500)
    helpers["assert_invariant"](client)


def test_fund_line_item_from_savings(client, helpers):
    _setup(client)
    car = _fund(client, "Car", 1000)
    fi = client.post("/line-items/", json={
        "name": "Car item", "type": "fund", "amount_cents": 1000, "fund_id": car["id"],
        "year": 2026, "month": 7}).json()
    before = helpers["get_state"](client)
    r = _spend(client, line_item_id=fi["id"], amount_cents=2500, cover={"from_savings": True})
    assert r.status_code == 200, r.text
    assert r.json()["covered_cents"] == 1500 and r.json()["covered_from"] == "Savings"
    after = helpers["get_state"](client)
    assert _fund_bal(after, car["id"]) == 0
    assert after["savings"]["balance_cents"] == before["savings"]["balance_cents"] - 1500
    assert after["monthly_reserve"] == before["monthly_reserve"]
    assert after["real_cash"]["balance_cents"] == before["real_cash"]["balance_cents"] - 2500
    helpers["assert_invariant"](client)


def test_zero_overage_ignores_cover(client, helpers):
    pc, gr = _setup(client)
    car = _fund(client, "Car", 5000)
    before = helpers["get_state"](client)
    # Even an otherwise-invalid source is ignored when nothing is over.
    r = _spend(client, line_item_id=pc["id"], amount_cents=8000, cover={"from_fund_id": car["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["covered_cents"] == 0 and r.json()["covered_from"] is None
    r = _spend(client, fund_id=car["id"], amount_cents=5000, cover={"from_savings": True})
    assert r.status_code == 200 and r.json()["covered_cents"] == 0
    after = helpers["get_state"](client)
    assert after["savings"] == before["savings"]
    assert after["monthly_reserve"]["target_cents"] == 38000
    assert _items(client)["Groceries"]["amount_cents"] == 30000
    assert not [e for e in _ledger(client, "transfer") if (e["label"] or "").startswith("Cover:")]
    helpers["assert_invariant"](client)


def test_no_cover_unchanged(client, helpers):
    pc, _ = _setup(client)
    car = _fund(client, "Car", 1000)
    # Leave it over: bill overspend allowed while MR has money; fund still 400.
    r = _spend(client, line_item_id=pc["id"], amount_cents=9000)
    assert r.status_code == 200 and r.json()["covered_cents"] == 0
    assert _spend(client, fund_id=car["id"], amount_cents=2000).status_code == 400
    helpers["assert_invariant"](client)


# ── Rejections ────────────────────────────────────────────────────────────────

def _assert_nothing_changed(client, helpers, before, n_tx=0):
    assert helpers["get_state"](client) == before
    assert len(client.get("/transactions/").json()) == n_tx


def test_wrong_source_types(client, helpers):
    pc, gr = _setup(client)
    car = _fund(client, "Car", 1000)
    gifts = _fund(client, "Gifts", 5000)
    fi = client.post("/line-items/", json={
        "name": "Car item", "type": "fund", "amount_cents": 1000, "fund_id": car["id"],
        "year": 2026, "month": 7}).json()
    before = helpers["get_state"](client)
    cases = [
        ({"line_item_id": pc["id"]}, {"from_fund_id": gifts["id"]}),        # Bill <- Fund
        ({"line_item_id": pc["id"]}, {"from_line_item_id": fi["id"]}),      # Bill <- fund-type item
        ({"line_item_id": pc["id"]}, {"from_line_item_id": pc["id"]}),      # Bill <- itself
        ({"fund_id": car["id"]}, {"from_line_item_id": gr["id"]}),          # Fund <- Bill
        ({"fund_id": car["id"]}, {"from_fund_id": car["id"]}),              # Fund <- itself
        ({"line_item_id": fi["id"]}, {"from_fund_id": car["id"]}),          # fund item <- its own fund
    ]
    for target, cover in cases:
        r = _spend(client, amount_cents=9000, cover=cover, **target)
        assert r.status_code == 400, (target, cover, r.text)
    _assert_nothing_changed(client, helpers, before)


def test_insufficient_sources(client, helpers):
    pc, gr = _setup(client)
    car = _fund(client, "Car", 1000)
    gifts = _fund(client, "Gifts", 500)
    _spend(client, line_item_id=gr["id"], amount_cents=29000)  # Groceries $10 unspent
    before = helpers["get_state"](client)

    r = _spend(client, line_item_id=pc["id"], amount_cents=10000, cover={"from_line_item_id": gr["id"]})
    assert r.status_code == 400
    assert "Groceries" in r.json()["detail"] and "$10.00 unspent" in r.json()["detail"] and "$20.00" in r.json()["detail"]

    r = _spend(client, fund_id=car["id"], amount_cents=2000, cover={"from_fund_id": gifts["id"]})
    assert r.status_code == 400
    assert r.json()["detail"] == "Gifts only has $5.00 — can't cover $10.00"

    client.post("/dev/set-savings", json={"balance_cents": 700})
    before = helpers["get_state"](client)
    r = _spend(client, fund_id=car["id"], amount_cents=2000, cover={"from_savings": True})
    assert r.status_code == 400
    assert r.json()["detail"] == "Savings only has $7.00 — can't cover $10.00"
    r = _spend(client, line_item_id=pc["id"], amount_cents=10000, cover={"from_savings": True})
    assert r.status_code == 400
    assert r.json()["detail"] == "Savings only has $7.00 — can't cover $20.00"
    _assert_nothing_changed(client, helpers, before, n_tx=1)
    helpers["assert_invariant"](client)


def test_past_month_bill_rejected(client, helpers):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})
    old = client.post("/line-items/", json={
        "name": "OldA", "type": "bill", "amount_cents": 1000, "year": 2026, "month": 6}).json()
    client.post("/line-items/", json={
        "name": "OldB", "type": "bill", "amount_cents": 5000, "year": 2026, "month": 6}).json()
    client.post("/dev/set-mr-balance", json={"balance_cents": 10000})
    before = helpers["get_state"](client)
    for cover in ({"from_savings": True}, {"from_line_item_id": old["id"] + 1}):
        r = _spend(client, line_item_id=old["id"], amount_cents=3000, date="2026-06-20", cover=cover)
        assert r.status_code == 400
        assert r.json()["detail"] == "Can only cover overspending in the current month"
    _assert_nothing_changed(client, helpers, before)


def test_savings_tx_and_source_count_rejected(client, helpers):
    pc, gr = _setup(client)
    before = helpers["get_state"](client)
    r = _spend(client, from_savings=True, merchant="Vet", amount_cents=100, cover={"from_savings": True})
    assert r.status_code == 400
    for cover in ({}, {"from_savings": True, "from_line_item_id": gr["id"]}):
        r = _spend(client, line_item_id=pc["id"], amount_cents=9000, cover=cover)
        assert r.status_code == 400, cover
    _assert_nothing_changed(client, helpers, before)


# ── Atomicity ─────────────────────────────────────────────────────────────────

def test_cover_rolls_back_when_spend_fails(client, helpers):
    pc, gr = _setup(client)
    # Bill <- Bill is budget-only; MR can't pay the spend, so the whole thing fails.
    client.post("/dev/set-mr-balance", json={"balance_cents": 5000})
    before = helpers["get_state"](client)
    r = _spend(client, line_item_id=pc["id"], amount_cents=9000, cover={"from_line_item_id": gr["id"]})
    assert r.status_code == 400 and "Monthly Reserve" in r.json()["detail"]
    _assert_nothing_changed(client, helpers, before)
    items = _items(client)
    assert items["Personal Care"]["amount_cents"] == 8000
    assert items["Groceries"]["amount_cents"] == 30000
    assert _ledger(client, "transfer") == []
    helpers["assert_invariant"](client)
