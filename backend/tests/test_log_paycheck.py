"""Real (non-dev) paycheck logging — POST /paycheck."""


def _state(client):
    return client.get("/state").json()


def test_log_paycheck_credits_savings_and_real_cash(client):
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})
    r = client.post("/income-sources", json={"name": "Job", "amount_cents": 250000, "frequency": "biweekly", "anchor_date": "2026-01-02"})
    source_id = r.json()["id"]

    r = client.post("/paycheck", json={"source_id": source_id})
    assert r.status_code == 200
    assert r.json()["added_cents"] == 250000

    s = _state(client)
    assert s["savings"]["balance_cents"] == 350000
    assert s["real_cash"]["balance_cents"] == 350000
    assert s["invariant_holds"] is True

    entries = client.get("/ledger/?kind=paycheck").json()
    assert entries and entries[0]["label"] == "Job" and entries[0]["amount_cents"] == 250000


def test_log_paycheck_amount_override(client):
    r = client.post("/income-sources", json={"name": "Job", "amount_cents": 250000, "frequency": "biweekly", "anchor_date": "2026-01-02"})
    source_id = r.json()["id"]
    r = client.post("/paycheck", json={"source_id": source_id, "amount_cents": 300000})
    assert r.status_code == 200 and r.json()["added_cents"] == 300000
    s = _state(client)
    assert s["savings"]["balance_cents"] == 300000
    assert s["invariant_holds"] is True


def test_log_paycheck_rejects_bad_input(client):
    assert client.post("/paycheck", json={"source_id": 999}).status_code == 404
    r = client.post("/income-sources", json={"name": "Job", "amount_cents": 250000, "frequency": "biweekly", "anchor_date": "2026-01-02"})
    source_id = r.json()["id"]
    assert client.post("/paycheck", json={"source_id": source_id, "amount_cents": 0}).status_code == 400
    s = _state(client)
    assert s["savings"]["balance_cents"] == 0
    assert s["invariant_holds"] is True
