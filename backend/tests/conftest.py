"""Pytest configuration and fixtures for budget app tests."""
import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Point DATABASE_URL at a throwaway sqlite file BEFORE importing the app.
tmp = tempfile.mkdtemp()
db_path = os.path.join(tmp, "test.db")
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

BACKEND = str(Path(__file__).parent.parent)
sys.path.insert(0, BACKEND)

# Import after path is set and env var is defined
import main  # noqa


@pytest.fixture(scope="session")
def client():
    """Session-scoped TestClient that runs startup migrations."""
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def reset_state(client):
    """Auto-reset database before each test."""
    r = client.post("/dev/reset")
    assert r.status_code == 200, f"Failed to reset: {r.text}"
    yield


def assert_invariant(client):
    """Assert that the invariant holds: real_cash == savings + mr + sum(fund_balances)."""
    r = client.get("/state")
    assert r.status_code == 200, f"Failed to get state: {r.text}"
    state = r.json()
    assert state["invariant_holds"] is True, f"Invariant broken: {state}"


def get_state(client):
    """Fetch and return the current state dict."""
    r = client.get("/state")
    assert r.status_code == 200, f"Failed to get state: {r.text}"
    return r.json()


@pytest.fixture
def helpers():
    """Provide helper functions for tests."""
    return {
        "assert_invariant": assert_invariant,
        "get_state": get_state,
    }
