"""Tests for optional user-chosen colors on Funds and line items (Bills)."""


def test_fund_color_set_and_read_back(client):
    r = client.post("/funds/", json={"name": "Vacation", "color": "#5a82c2"})
    assert r.status_code == 200
    fund = r.json()
    assert fund["color"] == "#5a82c2"

    r = client.get("/funds/")
    assert r.status_code == 200
    funds = r.json()
    saved = next(f for f in funds if f["id"] == fund["id"])
    assert saved["color"] == "#5a82c2"


def test_fund_color_defaults_to_null(client):
    r = client.post("/funds/", json={"name": "Vacation"})
    assert r.status_code == 200
    assert r.json()["color"] is None


def test_fund_create_invalid_hex_400(client):
    r = client.post("/funds/", json={"name": "Vacation", "color": "not-a-color"})
    assert r.status_code == 400

    r = client.post("/funds/", json={"name": "Vacation", "color": "#fff"})
    assert r.status_code == 400

    r = client.post("/funds/", json={"name": "Vacation", "color": "5a82c2"})
    assert r.status_code == 400


def test_fund_patch_invalid_hex_400(client):
    r = client.post("/funds/", json={"name": "Vacation"})
    fund_id = r.json()["id"]

    r = client.patch(f"/funds/{fund_id}", json={"color": "purple"})
    assert r.status_code == 400


def test_fund_patch_null_clears_color(client):
    r = client.post("/funds/", json={"name": "Vacation", "color": "#5a82c2"})
    fund_id = r.json()["id"]

    r = client.patch(f"/funds/{fund_id}", json={"color": None})
    assert r.status_code == 200
    assert r.json()["color"] is None

    r = client.get("/funds/")
    saved = next(f for f in r.json() if f["id"] == fund_id)
    assert saved["color"] is None


def test_bill_color_set_and_read_back(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7,
        "color": "#00ff00",
    })
    assert r.status_code == 200
    assert r.json()["color"] == "#00ff00"

    r = client.get("/line-items/", params={"year": 2026, "month": 7})
    saved = next(i for i in r.json() if i["name"] == "Rent")
    assert saved["color"] == "#00ff00"


def test_bill_create_invalid_hex_400(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "color": "#zzzzzz",
    })
    assert r.status_code == 400


def test_bill_patch_invalid_hex_400(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
    })
    item_id = r.json()["id"]

    r = client.patch(f"/line-items/{item_id}", json={"color": "#12345"})
    assert r.status_code == 400


def test_bill_patch_null_clears_color(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "color": "#5a82c2",
    })
    item_id = r.json()["id"]

    r = client.patch(f"/line-items/{item_id}", json={"color": None})
    assert r.status_code == 200
    assert r.json()["color"] is None


def test_plan_copy_carries_bill_color_to_next_month(client):
    """A bill's chosen color persists when its plan is copied into a new month."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7,
        "color": "#5a82c2",
    })

    # Jump to August — auto-copy should carry the color along.
    client.post("/dev/set-simulated-date", json={"date": "2026-08-10"})

    r = client.get("/plans/2026/8")
    assert r.status_code == 200
    august_items = r.json()["line_items"]
    aug_rent = next(i for i in august_items if i["name"] == "Rent")
    assert aug_rent["color"] == "#5a82c2"
