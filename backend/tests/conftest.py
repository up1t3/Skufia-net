import pytest
import uuid
from fastapi.testclient import TestClient
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app
from database import Base, engine, SessionLocal, User, Profile
from auth import get_password_hash

Base.metadata.create_all(bind=engine)

@pytest.fixture(autouse=True)
def mock_idempotency_header(monkeypatch):
    from starlette.testclient import TestClient
    original_request = TestClient.request

    def request_with_idempotency(self, method, url, **kwargs):
        if method.lower() in ("post", "put", "delete"):
            headers = kwargs.get("headers")
            if headers is None:
                new_headers = {}
            else:
                new_headers = dict(headers)

            # Always override to ensure uniqueness per request in tests
            new_headers["X-Idempotency-Key"] = uuid.uuid4().hex
            kwargs["headers"] = new_headers
        return original_request(self, method, url, **kwargs)

    monkeypatch.setattr(TestClient, "request", request_with_idempotency)

@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture(scope="session")
def test_user():
    db = SessionLocal()
    db.query(Profile).filter(Profile.user.has(username="upload_test_user")).delete(synchronize_session=False)
    db.query(User).filter(User.username == "upload_test_user").delete()
    db.commit()

    user = User(
        username="upload_test_user",
        email="upload_test@skufia.net",
        hashed_password=get_password_hash("password123")
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    yield user
    db.close()

@pytest.fixture(scope="session")
def auth_headers(client, test_user):
    # Need to pass JSON for login endpoint based on LoginRequest Pydantic model
    response = client.post(
        "/api/auth/login",
        json={"username": "upload_test_user", "password": "password123"}
    )

    data = response.json()
    if "access_token" not in data:
        print(f"Error getting token: {data}")
        print(f"Status code: {response.status_code}")
        raise ValueError("Failed to get access token")

    token = data["access_token"]
    return {"Authorization": f"Bearer {token}"}
