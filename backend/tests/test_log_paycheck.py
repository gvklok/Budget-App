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


def test_log_misc_income_credits_savings_and_real_cash(client):
    client.post("/dev/set-real-cash", json={"balance_cents": 100000})

    r = client.post("/income/misc", json={"amount_cents": 5000, "label": "Birthday gift"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "added_cents": 5000, "label": "Birthday gift"}

    s = _state(client)
    assert s["savings"]["balance_cents"] == 105000
    assert s["real_cash"]["balance_cents"] == 105000
    assert s["invariant_holds"] is True

    entries = client.get("/ledger/?kind=misc_income").json()
    assert entries and entries[0]["label"] == "Birthday gift" and entries[0]["amount_cents"] == 5000
    assert entries[0]["from_bucket"] == "external" and entries[0]["to_bucket"] == "savings"

    # never touches paycheck's ledger kind or IncomeSource
    assert client.get("/ledger/?kind=paycheck").json() == []
    assert client.get("/income-sources").json() == []


def test_log_misc_income_default_label_and_explicit_date(client):
    r = client.post("/income/misc", json={"amount_cents": 1200, "date": "2026-01-05"})
    assert r.status_code == 200
    assert r.json()["label"] == "Other income"
    entries = client.get("/ledger/?kind=misc_income").json()
    assert entries[0]["date"] == "2026-01-05"


def test_log_misc_income_rejects_bad_input(client):
    assert client.post("/income/misc", json={"amount_cents": 0}).status_code == 400
    assert client.post("/income/misc", json={"amount_cents": -100}).status_code == 400
    s = _state(client)
    assert s["savings"]["balance_cents"] == 0
    assert s["invariant_holds"] is True


def test_log_misc_income_never_affects_expected_income_projection(client):
    r = client.post("/income-sources", json={"name": "Job", "amount_cents": 250000, "frequency": "biweekly", "anchor_date": "2026-01-02"})
    assert r.status_code == 200
    before = client.get("/monthly-summary", params={"year": 2026, "month": 1}).json()

    client.post("/income/misc", json={"amount_cents": 999999, "label": "Big gift"})

    after = client.get("/monthly-summary", params={"year": 2026, "month": 1}).json()
    assert after["expected_income_cents"] == before["expected_income_cents"]
    # still only the one real recurring source
    assert len(client.get("/income-sources").json()) == 1
