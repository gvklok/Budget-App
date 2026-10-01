"""Bill rebalance, per-bill spent_cents, and month-scoped reporting."""


def _setup(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})
    mk = lambda name, amt, **kw: client.post("/line-items/", json={
        "name": name, "type": "bill", "amount_cents": amt, "year": 2026, "month": 7, **kw}).json()
    pc, gr = mk("Personal Care", 8000), mk("Groceries", 30000)
    client.post("/monthly-reserve/top-off")
    return pc, gr


def test_monthly_and_balance_series_explicit_end(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-08-12"})
    client.post("/dev/set-savings", json={"balance_cents": 1000000})
    bill = client.post("/line-items/", json={
        "name": "Rent", "type": "bill", "amount_cents": 20000, "year": 2026, "month": 7}).json()
    client.post("/dev/set-mr-balance", json={"balance_cents": 20000})
    client.post("/transactions/", json={"line_item_id": bill["id"], "amount_cents": 5000, "date": "2026-07-15"})

    default = client.get("/overview/monthly", params={"months": 2}).json()["months"]
    assert [(m["year"], m["month"]) for m in default] == [(2026, 7), (2026, 8)]
    scoped = client.get("/overview/monthly", params={"months": 2, "year": 2026, "month": 7}).json()["months"]
    assert [(m["year"], m["month"]) for m in scoped] == [(2026, 6), (2026, 7)]
    assert scoped[-1]["bills_spent_cents"] == 5000

    client.post("/transactions/", json={"line_item_id": bill["id"], "amount_cents": 700, "date": "2026-08-02"})
    full = client.get("/overview/balance-series", params={"months": 2}).json()["series"]["real_cash"]
    cut = client.get("/overview/balance-series",
                     params={"months": 2, "year": 2026, "month": 7}).json()["series"]["real_cash"]
    assert max(p["date"] for p in full) >= "2026-08-02"
    assert all(p["date"] <= "2026-07-31" for p in cut)
    assert cut[0]["date"] == "2026-06-01"


def test_monthly_summary_bill_status_fields(client):
    pc, gr = _setup(client)
    s = client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()
    assert s["bills_planned_cents"] == 38000 == s["expected_bills_total_cents"]
    assert s["bills_spent_cents"] == 0 and s["bills_over_cents"] == 0
    client.post("/transactions/", json={"line_item_id": pc["id"], "amount_cents": 9500, "date": "2026-07-13"})
    s = client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()
    assert s["bills_spent_cents"] == 9500 and s["bills_over_cents"] == 0  # total-level, under planned
    client.post("/dev/set-mr-balance", json={"balance_cents": 60000})
    client.post("/transactions/", json={"line_item_id": gr["id"], "amount_cents": 30000, "date": "2026-07-14"})
    client.post("/transactions/", json={"line_item_id": gr["id"], "amount_cents": 1000, "date": "2026-07-15"})
    s = client.get("/monthly-summary", params={"year": 2026, "month": 7}).json()
    assert s["bills_spent_cents"] == 40500
    assert s["bills_over_cents"] == 2500
    assert "savings_withdrawals_cents" in s
