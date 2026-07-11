"""Tests for user-controlled ordering of funds and line items.

Covers the /funds/reorder and /line-items/reorder endpoints, including
validation rules and downstream effects (distribute funding priority).
"""
import pytest


def test_funds_reorder_round_trip(client, helpers):
    """Reordering funds changes the order returned by /funds/."""
    a = client.post("/funds/", json={"name": "Alpha"}).json()
    b = client.post("/funds/", json={"name": "Bravo"}).json()
    c = client.post("/funds/", json={"name": "Charlie"}).json()

    # Default order should follow creation order.
    r = client.get("/funds/")
    assert [f["id"] for f in r.json()] == [a["id"], b["id"], c["id"]]

    # Reorder: Charlie, Alpha, Bravo.
    new_order = [c["id"], a["id"], b["id"]]
    r = client.post("/funds/reorder", json={"ordered_ids": new_order})
    assert r.status_code == 200
    assert [f["id"] for f in r.json()] == new_order

    r = client.get("/funds/")
    assert [f["id"] for f in r.json()] == new_order
    helpers["assert_invariant"](client)


def test_funds_reorder_rejects_incomplete_set(client):
    """Reorder must include exactly the full set of existing fund ids."""
    a = client.post("/funds/", json={"name": "Alpha"}).json()
    client.post("/funds/", json={"name": "Bravo"}).json()

    r = client.post("/funds/reorder", json={"ordered_ids": [a["id"]]})
    assert r.status_code == 400

    r = client.post("/funds/reorder", json={"ordered_ids": [a["id"], 99999]})
    assert r.status_code == 400


def test_funds_reorder_changes_distribute_priority(client, helpers):
    """Distribute funds in sort_order — reordering changes who gets funded
    first when savings can't cover every contribution."""
    a = client.post("/funds/", json={"name": "Alpha", "monthly_contribution_cents": 500}).json()
    b = client.post("/funds/", json={"name": "Bravo", "monthly_contribution_cents": 500}).json()
    c = client.post("/funds/", json={"name": "Charlie", "monthly_contribution_cents": 500}).json()

    # Enough savings for exactly two funds' contributions.
    client.post("/dev/set-savings", json={"balance_cents": 1000})

    # Put Charlie and Bravo ahead of Alpha.
    r = client.post("/funds/reorder", json={"ordered_ids": [c["id"], b["id"], a["id"]]})
    assert r.status_code == 200

    r = client.post("/funds/distribute")
    assert r.status_code == 200
    body = r.json()
    funded_ids = [f["id"] for f in body["funded"]]
    skipped_ids = [f["id"] for f in body["skipped"]]
    assert funded_ids == [c["id"], b["id"]]
    assert skipped_ids == [a["id"]]
    helpers["assert_invariant"](client)


def test_line_items_reorder_round_trip(client):
    """Reordering line items within a plan changes /line-items/ order."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    r1 = client.post("/line-items/", json={"name": "Rent", "type": "bill", "amount_cents": 100000})
    r2 = client.post("/line-items/", json={"name": "Internet", "type": "bill", "amount_cents": 5000})
    r3 = client.post("/line-items/", json={"name": "Phone", "type": "bill", "amount_cents": 3000})
    rent, internet, phone = r1.json(), r2.json(), r3.json()

    r = client.get("/line-items/")
    assert [i["id"] for i in r.json()] == [rent["id"], internet["id"], phone["id"]]

    new_order = [phone["id"], rent["id"], internet["id"]]
    r = client.post("/line-items/reorder", json={"ordered_ids": new_order})
    assert r.status_code == 200
    assert [i["id"] for i in r.json()] == new_order

    r = client.get("/line-items/")
    assert [i["id"] for i in r.json()] == new_order


def test_line_items_reorder_rejects_cross_plan(client):
    """Reorder must reject ids spanning more than one plan."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    july_item = client.post("/line-items/", json={
        "name": "Rent", "type": "bill", "amount_cents": 100000, "year": 2026, "month": 7
    }).json()

    client.post("/dev/set-simulated-date", json={"date": "2026-08-10"})
    aug_item = client.post("/line-items/", json={
        "name": "Extra", "type": "bill", "amount_cents": 2000, "year": 2026, "month": 8
    }).json()

    r = client.post("/line-items/reorder", json={"ordered_ids": [july_item["id"], aug_item["id"]]})
    assert r.status_code == 400


def test_line_items_reorder_rejects_unknown_id(client):
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})
    item = client.post("/line-items/", json={"name": "Rent", "type": "bill", "amount_cents": 100000}).json()

    r = client.post("/line-items/reorder", json={"ordered_ids": [item["id"], 99999]})
    assert r.status_code == 400
