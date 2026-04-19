import pytest
import uuid

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
