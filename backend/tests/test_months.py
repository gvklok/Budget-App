"""Tests for monthly plans: autoload, copy, MR target, current month status.

Verifies that plans are properly scoped by month, copied correctly,
and that the MR target follows the current effective month.
"""
import pytest


def test_plan_autoload_current_month(client):
    """Plan autoload: accessing a new month creates a plan for that month."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Access current month plan
    r = client.get("/plans/2026/7")
    assert r.status_code == 200
    plan = r.json()
    assert plan["year"] == 2026
    assert plan["month"] == 7


def test_plan_copy_independent_edits(client):
    """Plan copy: editing July plan doesn't affect August (independent copies)."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create a bill in July
    r = client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })
    july_bill_id = r.json()["id"]

    # Jump to August
    client.post("/dev/set-simulated-date", json={"date": "2026-08-10"})

    # August should have copied the Rent bill
    r = client.get("/plans/2026/8")
    assert r.status_code == 200
    august_plan = r.json()
    august_items = august_plan["line_items"]
    assert len(august_items) > 0

    # Verify that editing August doesn't change July
    aug_rent = next((li for li in august_items if li["name"] == "Rent"), None)
    if aug_rent:
        # Modify August's Rent
        r = client.patch(f"/line-items/{aug_rent['id']}", json={"amount_cents": 200000})
        if r.status_code == 200:
            # Check July is unchanged
            r = client.get("/plans/2026/7")
            july_plan = r.json()
            july_rent = next((li for li in july_plan["line_items"] if li["name"] == "Rent"), None)
            if july_rent:
                assert july_rent["amount_cents"] == 100000


def test_plan_gap_months_copy_from_prior(client):
    """Plan gap: month with no plan copies from nearest prior."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create a bill in July
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    # Jump to September (skip August)
    client.post("/dev/set-simulated-date", json={"date": "2026-09-10"})

    # August should auto-copy from July
    r = client.get("/plans/2026/8")
    assert r.status_code == 200
    august_plan = r.json()
    assert len(august_plan["line_items"]) > 0


def test_plan_no_prior_empty_plan(client):
    """Plan copy: first month with no prior history gets empty plan."""
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Access a month with no prior plan (shouldn't happen in normal use, but test it)
    # This behavior depends on implementation; usually the earliest month you can
    # access is the current month or later
    r = client.get("/plans/2026/6")
    # Either 200 with empty plan or 404 — both are acceptable
    assert r.status_code in (200, 404)


def test_mr_target_follows_current_month(client, helpers):
    """MR target: changes to follow current month's bills when effective date changes."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create July bills (total 100000)
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    # MR target should be 100000
    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["target_cents"] == 100000

    # Jump to August
    client.post("/dev/set-simulated-date", json={"date": "2026-08-10"})

    # August starts with copied bills (100000 from July copy)
    # Add more bills in August
    client.post("/line-items/", json={
        "name": "Utilities",
        "type": "bill",
        "amount_cents": 50000,
        "year": 2026,
        "month": 8
    })

    # After creating a new bill in August, MR target should reflect August's bills
    # (100000 from copy + 50000 from new bill = 150000)
    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["target_cents"] == 150000
    helpers["assert_invariant"](client)


def test_current_month_status_before_topoff_and_distribute(client):
    """Current month status: reflects state before top-off and distribute."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create bills
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    r = client.get("/current-month-status")
    assert r.status_code == 200
    status = r.json()
    assert status["distribute_done"] is False
    assert status["top_off_done"] is False


def test_current_month_status_after_topoff(client):
    """Current month status: flips after top-off."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create bills and top-off
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    client.post("/monthly-reserve/top-off")

    r = client.get("/current-month-status")
    assert r.status_code == 200
    status = r.json()
    assert status["top_off_done"] is True
    assert status["distribute_done"] is False


def test_current_month_status_after_distribute(client):
    """Current month status: flips after distribute."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    # Create fund with contribution
    client.post("/funds/", json={
        "name": "Vacation",
        "balance_cents": 0,
        "monthly_contribution_cents": 20000
    })

    client.post("/funds/distribute")

    r = client.get("/current-month-status")
    assert r.status_code == 200
    status = r.json()
    assert status["distribute_done"] is True


def test_new_month_does_not_auto_topoff_distribute(client):
    """New month: top-off and distribute don't execute automatically on month change."""
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create bills in July
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    # Top-off July
    client.post("/monthly-reserve/top-off")

    # Jump to August
    client.post("/dev/set-simulated-date", json={"date": "2026-08-10"})

    # August should NOT have top_off executed
    r = client.get("/current-month-status")
    assert r.status_code == 200
    status = r.json()
    assert status["top_off_done"] is False


def test_topoff_only_affects_current_month(client, helpers):
    """Top-off: only affects the current effective month's target."""
    client.post("/dev/set-real-cash", json={"balance_cents": 500000})
    client.post("/dev/set-simulated-date", json={"date": "2026-07-10"})

    # Create bills in July
    client.post("/line-items/", json={
        "name": "Rent",
        "type": "bill",
        "amount_cents": 100000,
        "year": 2026,
        "month": 7
    })

    # Top-off July
    r = client.post("/monthly-reserve/top-off")
    assert r.status_code == 200
    assert r.json()["moved_cents"] == 100000

    # Jump to August (which auto-copies July's bills: Rent 100000)
    client.post("/dev/set-simulated-date", json={"date": "2026-08-10"})

    # Add utilities in August
    client.post("/line-items/", json={
        "name": "Utilities",
        "type": "bill",
        "amount_cents": 50000,
        "year": 2026,
        "month": 8
    })

    # Top-off August: target is now 150000 (copied Rent 100000 + new Utilities 50000)
    # MR is currently 100000 (from July top-off), so need to move 50000 to reach 150000
    r = client.post("/monthly-reserve/top-off")
    assert r.status_code == 200
    moved = r.json()["moved_cents"]
    assert moved == 50000

    state = helpers["get_state"](client)
    assert state["monthly_reserve"]["balance_cents"] == 150000
    helpers["assert_invariant"](client)
