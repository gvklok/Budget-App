"""Allocation-based savings rate: fund_contributions (distribute only) / set_aside_from_savings / saved / cash_out / net_cash."""


def _setup(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    client.post("/income-sources", json={"name": "Job", "amount_cents": 500000, "frequency": "monthly", "anchor_date": "2026-01-01"})
    client.post("/dev/simulate-paycheck")


def _jul(client):
    return client.get("/overview/monthly", params={"months": 1}).json()["months"][0]


def _summary(client):
    return client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()


def _fund(client, name="F", balance=0, contribution=0, **kw):
    return client.post("/funds/", json={"name": name, "balance_cents": balance, "monthly_contribution_cents": contribution, **kw}).json()


def _both(client, **expected):
    for row in (_jul(client), _summary(client)):
        for k, v in expected.items():
            assert row[k] == v, (k, row[k], v)


def test_distribute_counts(client):
    _setup(client)
    _fund(client, contribution=30000)
    assert client.post("/funds/distribute").status_code == 200
    _both(client, fund_contributions_cents=30000, saved_cents=500000 - 30000)


def test_fund_spend_does_not_change_saved(client):
    _setup(client)
    f = _fund(client, balance=40000)
    before = _jul(client)
    client.post("/transactions/", json={"amount_cents": 15000, "date": "2026-07-11", "merchant": "x", "fund_id": f["id"]})
    after = _jul(client)
    assert after["saved_cents"] == before["saved_cents"] == 500000
    assert after["cash_out_cents"] == 15000
    _both(client, cash_out_cents=15000, fund_contributions_cents=0, set_aside_from_savings_cents=40000)


def test_cover_fund_to_fund_does_not_count(client):
    _setup(client)
    f = _fund(client, balance=1000)
    g = _fund(client, name="G", balance=5000)
    r = client.post("/transactions/", json={"amount_cents": 5000, "date": "2026-07-11", "merchant": "x", "fund_id": f["id"], "cover": {"from_fund_id": g["id"]}})
    assert r.status_code == 200, r.text
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=1000 + 5000)


def test_fund_delete_sweep_subtracts(client):
    _setup(client)
    f = _fund(client, balance=20000)
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=20000)
    client.delete(f"/funds/{f['id']}")
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=0, saved_cents=500000)


def test_fund_delete_sweep_negative_set_aside(client):
    # Deleting a fund sweeps it back to Savings: undoing an earmark, neutral to saved.
    _setup(client)
    f = _fund(client, contribution=20000)
    client.post("/funds/distribute")
    client.delete(f"/funds/{f['id']}")
    _both(client, fund_contributions_cents=20000, set_aside_from_savings_cents=-20000)


def test_initial_balance_is_set_aside_not_contribution(client):
    _setup(client)
    _fund(client, balance=30000)
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=30000, saved_cents=500000)


def test_later_savings_to_fund_transfer_counts(client):
    # Owner ruling: only fund setup is neutral; a later Savings->Fund move counts.
    _setup(client)
    f = _fund(client)
    client.post("/transfers/", json={"from_bucket": "savings", "to_bucket": f"fund:{f['id']}", "amount_cents": 7000})
    _both(client, fund_contributions_cents=7000, set_aside_from_savings_cents=0, saved_cents=500000 - 7000)
    client.post("/transfers/", json={"from_bucket": f"fund:{f['id']}", "to_bucket": "savings", "amount_cents": 2000})
    _both(client, fund_contributions_cents=5000, saved_cents=500000 - 5000)


def test_adjustment_counts_in_neither(client):
    _setup(client)
    f = _fund(client)
    client.post("/dev/set-fund-balance", json={"fund_id": f["id"], "balance_cents": 12000})
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=0, saved_cents=500000)


def test_transfer_out_fund_distribute_counts(client):
    _setup(client)
    _fund(client, "Roth", contribution=25000, destination_type="transfer_out")
    client.post("/funds/distribute")
    _both(client, fund_contributions_cents=25000, set_aside_from_savings_cents=0, saved_cents=500000 - 25000)


def test_fund_to_fund_neutral(client):
    _setup(client)
    a, b = _fund(client, "A", balance=20000), _fund(client, "B")
    client.post("/transfers/", json={"from_bucket": f"fund:{a['id']}", "to_bucket": f"fund:{b['id']}", "amount_cents": 5000})
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=20000)


def test_transfer_out_fund_initial_balance_is_set_aside_and_transfer_out_is_neutral(client):
    _setup(client)
    t = _fund(client, "Roth", balance=30000, destination_type="transfer_out")
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=30000, transfers_out_cents=0, saved_cents=500000)
    client.post("/transactions/", json={"amount_cents": 10000, "date": "2026-07-11", "merchant": "x", "fund_id": t["id"]})
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=30000, transfers_out_cents=10000, saved_cents=500000)


def test_regular_to_transfer_out_fund_is_neutral(client):
    _setup(client)
    a, t = _fund(client, "A", balance=20000), _fund(client, "Roth", destination_type="transfer_out")
    client.post("/transfers/", json={"from_bucket": f"fund:{a['id']}", "to_bucket": f"fund:{t['id']}", "amount_cents": 5000})
    _both(client, fund_contributions_cents=0, set_aside_from_savings_cents=20000)


def test_savings_transfer_out_counted(client):
    _setup(client)
    client.post("/transactions/", json={"amount_cents": 9000, "date": "2026-07-08", "merchant": "Fid", "from_savings": True, "destination_type": "transfer_out"})
    _both(client, transfers_out_cents=9000, saved_cents=500000, cash_out_cents=0, net_cash_cents=500000 - 9000)


def test_net_cash_identity(client, helpers):
    _setup(client)
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    bill = client.post("/line-items/", json={"name": "Rent", "type": "bill", "amount_cents": 50000, "year": 2026, "month": 7}).json()["id"]
    client.post("/monthly-reserve/top-off")
    f = _fund(client, balance=40000)
    client.post("/transactions/", json={"amount_cents": 20000, "date": "2026-07-11", "merchant": "r", "line_item_id": bill})
    client.post("/transactions/", json={"amount_cents": 7000, "date": "2026-07-11", "merchant": "f", "fund_id": f["id"]})
    client.post("/transactions/", json={"amount_cents": 3000, "date": "2026-07-11", "merchant": "s", "from_savings": True})
    client.post("/transactions/", json={"amount_cents": 9000, "date": "2026-07-11", "merchant": "o", "from_savings": True, "destination_type": "transfer_out"})
    tx = client.post("/transactions/", json={"amount_cents": 1000, "date": "2026-07-11", "merchant": "d", "fund_id": f["id"]}).json()
    client.delete(f"/transactions/{tx['id']}")
    rows = client.get("/overview/monthly", params={"months": 3}).json()["months"]
    real_cash = helpers["get_state"](client)["real_cash"]["balance_cents"]
    # Real Cash started at 0 after reset; paycheck in, spends out net of reversals.
    assert sum(r["net_cash_cents"] for r in rows) == real_cash
    helpers["assert_invariant"](client)
