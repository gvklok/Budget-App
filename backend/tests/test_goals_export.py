"""Tests for fund goals (goal_cents) and the /export backup endpoint."""


def test_fund_goal_set_on_create(client):
    r = client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 0,
        "monthly_contribution_cents": 0,
        "goal_cents": 500000,
    })
    assert r.status_code == 200
    assert r.json()["goal_cents"] == 500000


def test_fund_goal_negative_or_zero_rejected_on_create(client):
    r = client.post("/funds/", json={
        "name": "Vacation",
        "goal_cents": 0,
    })
    assert r.status_code == 400
    assert "positive" in r.json()["detail"].lower()

    r = client.post("/funds/", json={
        "name": "Vacation",
        "goal_cents": -100,
    })
    assert r.status_code == 400
    assert "positive" in r.json()["detail"].lower()


def test_fund_goal_defaults_to_null(client):
    r = client.post("/funds/", json={"name": "No Goal"})
    assert r.status_code == 200
    assert r.json()["goal_cents"] is None


def test_fund_goal_set_via_patch(client):
    r = client.post("/funds/", json={"name": "Vacation"})
    fund_id = r.json()["id"]

    r = client.patch(f"/funds/{fund_id}", json={"goal_cents": 250000})
    assert r.status_code == 200
    assert r.json()["goal_cents"] == 250000


def test_fund_goal_patch_negative_rejected(client):
    r = client.post("/funds/", json={"name": "Vacation"})
    fund_id = r.json()["id"]

    r = client.patch(f"/funds/{fund_id}", json={"goal_cents": -1})
    assert r.status_code == 400
    assert "positive" in r.json()["detail"].lower()


def test_fund_goal_cleared_via_explicit_null_patch(client):
    r = client.post("/funds/", json={"name": "Vacation", "goal_cents": 100000})
    fund_id = r.json()["id"]
    assert r.json()["goal_cents"] == 100000

    r = client.patch(f"/funds/{fund_id}", json={"goal_cents": None})
    assert r.status_code == 200
    assert r.json()["goal_cents"] is None


def test_fund_goal_omitted_on_patch_leaves_unchanged(client):
    r = client.post("/funds/", json={"name": "Vacation", "goal_cents": 100000})
    fund_id = r.json()["id"]

    r = client.patch(f"/funds/{fund_id}", json={"name": "Vacation Fund"})
    assert r.status_code == 200
    assert r.json()["goal_cents"] == 100000


def test_export_returns_all_tables(client):
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    client.post("/funds/", json={"name": "Vacation", "goal_cents": 100000})
    client.post("/income-sources", json={"name": "Job", "amount_cents": 500000, "frequency": "monthly"})
    client.post("/checklist/", json={"name": "Pay rent"})
    client.post("/line-items/categories", json={"name": "Housing"})
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7,
    })

    r = client.get("/export")
    assert r.status_code == 200
    body = r.json()

    assert body["app"] == "budget-app"
    assert body["version"] == 1
    assert "exported_at" in body

    data = body["data"]
    for key in [
        "real_cash", "savings", "monthly_reserve", "funds", "monthly_plans",
        "line_items", "transactions", "ledger_entries", "income_sources",
        "checklist_items", "expense_categories", "app_clock",
    ]:
        assert key in data, f"missing {key}"

    assert len(data["funds"]) == 1
    assert data["funds"][0]["goal_cents"] == 100000
    assert len(data["income_sources"]) == 1
    assert len(data["checklist_items"]) == 1
    assert len(data["expense_categories"]) == 1
    assert len(data["line_items"]) == 1
    assert len(data["monthly_plans"]) >= 1


def test_export_content_disposition_header(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    r = client.get("/export")
    assert r.status_code == 200
    disposition = r.headers.get("content-disposition", "")
    assert "attachment" in disposition
    assert "budget-export-2026-07-10.json" in disposition
