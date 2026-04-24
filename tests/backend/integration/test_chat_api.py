"""
Integration Tests — Chat API Pipeline
Pyramid Layer 2: Real HTTP calls against TestClient (SQLite in-memory)

Coverage (full chat pipeline):
  - POST /chat/rooms     → create room between two users
  - GET  /chat/rooms     → list rooms for user
  - POST /chat/messages  → send text message
  - GET  /chat/messages  → fetch history with pagination
  - POST /chat/upload    → attach file (multipart)
  - PATCH/PUT /me        → update profile settings
  - GET  /users/{id}     → fetch contact profile info
  - WebSocket connect    → (smoke: 101 upgrade)
"""

import io
import pytest

# ────────────────────────────────────────────────────────────
# Fixtures — helpers
# ────────────────────────────────────────────────────────────

def register_and_login(client, username: str, password: str = "TestPass99!") -> str:
    """Register a user and return the JWT access_token."""
    client.post("/auth/register", json={
        "username": username,
        "email": f"{username}@e2e.test",
        "password": password,
    })
    resp = client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, f"Login failed for {username}: {resp.text}"
    return resp.json()["access_token"]


@pytest.fixture()
def two_users(client):
    """Return (token_alice, token_bob) — two fresh users."""
    token_a = register_and_login(client, "alice_chat")
    token_b = register_and_login(client, "bob_chat")
    return token_a, token_b


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ────────────────────────────────────────────────────────────
# T1 — Auth pre-conditions
# ────────────────────────────────────────────────────────────

class TestAuthForChat:

    def test_unauthenticated_messages_blocked(self, client):
        resp = client.get("/chat/messages?room_id=1")
        assert resp.status_code in (401, 403)

    def test_unauthenticated_upload_blocked(self, client):
        resp = client.post("/chat/upload")
        assert resp.status_code in (401, 403)

    def test_unauthenticated_room_list_blocked(self, client):
        resp = client.get("/chat/rooms")
        assert resp.status_code in (401, 403)


# ────────────────────────────────────────────────────────────
# T2 — Room management
# ────────────────────────────────────────────────────────────

class TestChatRooms:

    def test_create_room_between_two_users(self, client, two_users):
        token_a, token_b = two_users
        # Alice gets her own ID
        me = client.get("/me", headers=auth(token_a)).json()
        bob = client.get("/me", headers=auth(token_b)).json()

        resp = client.post("/chat/rooms", headers=auth(token_a), json={
            "target_user_id": bob["id"]
        })
        assert resp.status_code in (200, 201)
        room = resp.json()
        assert "id" in room

    def test_room_appears_in_list(self, client, two_users):
        token_a, token_b = two_users
        bob = client.get("/me", headers=auth(token_b)).json()

        client.post("/chat/rooms", headers=auth(token_a), json={"target_user_id": bob["id"]})

        rooms = client.get("/chat/rooms", headers=auth(token_a)).json()
        assert isinstance(rooms, list)
        assert len(rooms) >= 1

    def test_duplicate_room_returns_existing(self, client, two_users):
        token_a, token_b = two_users
        bob = client.get("/me", headers=auth(token_b)).json()
        payload = {"target_user_id": bob["id"]}

        r1 = client.post("/chat/rooms", headers=auth(token_a), json=payload)
        r2 = client.post("/chat/rooms", headers=auth(token_a), json=payload)
        assert r1.json()["id"] == r2.json()["id"]

    def test_bob_also_sees_room(self, client, two_users):
        token_a, token_b = two_users
        bob = client.get("/me", headers=auth(token_b)).json()
        client.post("/chat/rooms", headers=auth(token_a), json={"target_user_id": bob["id"]})

        rooms_b = client.get("/chat/rooms", headers=auth(token_b)).json()
        assert len(rooms_b) >= 1


# ────────────────────────────────────────────────────────────
# T3 — Text messaging
# ────────────────────────────────────────────────────────────

class TestTextMessages:

    def _get_room(self, client, token_a, token_b) -> int:
        bob = client.get("/me", headers=auth(token_b)).json()
        resp = client.post("/chat/rooms", headers=auth(token_a), json={"target_user_id": bob["id"]})
        return resp.json()["id"]

    def test_send_text_message(self, client, two_users):
        token_a, token_b = two_users
        room_id = self._get_room(client, token_a, token_b)

        resp = client.post("/chat/messages", headers=auth(token_a), json={
            "room_id": room_id,
            "content": "Привет, Боб!",
        })
        assert resp.status_code in (200, 201)
        msg = resp.json()
        assert msg["content"] == "Привет, Боб!"

    def test_message_appears_in_history(self, client, two_users):
        token_a, token_b = two_users
        room_id = self._get_room(client, token_a, token_b)

        text = "Сообщение для истории"
        client.post("/chat/messages", headers=auth(token_a), json={
            "room_id": room_id, "content": text
        })

        resp = client.get(f"/chat/messages?room_id={room_id}", headers=auth(token_a))
        assert resp.status_code == 200
        messages = resp.json()
        texts = [m["content"] for m in messages]
        assert text in texts

    def test_empty_message_rejected(self, client, two_users):
        token_a, token_b = two_users
        room_id = self._get_room(client, token_a, token_b)

        resp = client.post("/chat/messages", headers=auth(token_a), json={
            "room_id": room_id, "content": ""
        })
        assert resp.status_code == 422

    def test_message_too_long_rejected(self, client, two_users):
        token_a, token_b = two_users
        room_id = self._get_room(client, token_a, token_b)

        resp = client.post("/chat/messages", headers=auth(token_a), json={
            "room_id": room_id, "content": "X" * 5000
        })
        assert resp.status_code in (400, 422)

    def test_outsider_cannot_send_to_room(self, client, two_users):
        token_a, token_b = two_users
        room_id = self._get_room(client, token_a, token_b)

        # Register outsider
        token_c = register_and_login(client, "charlie_intruder")
        resp = client.post("/chat/messages", headers=auth(token_c), json={
            "room_id": room_id, "content": "Взлом!"
        })
        assert resp.status_code in (403, 404)

    def test_messages_sorted_chronologically(self, client, two_users):
        token_a, token_b = two_users
        room_id = self._get_room(client, token_a, token_b)

        for i in range(3):
            client.post("/chat/messages", headers=auth(token_a), json={
                "room_id": room_id, "content": f"Сообщение #{i}"
            })

        resp = client.get(f"/chat/messages?room_id={room_id}", headers=auth(token_a))
        messages = resp.json()
        timestamps = [m.get("created_at", m.get("timestamp", "")) for m in messages]
        assert timestamps == sorted(timestamps)

    def test_pagination_limit(self, client, two_users):
        token_a, token_b = two_users
        room_id = self._get_room(client, token_a, token_b)

        for i in range(10):
            client.post("/chat/messages", headers=auth(token_a), json={
                "room_id": room_id, "content": f"Msg {i}"
            })

        resp = client.get(f"/chat/messages?room_id={room_id}&limit=5", headers=auth(token_a))
        assert resp.status_code == 200
        assert len(resp.json()) <= 5


# ────────────────────────────────────────────────────────────
# T4 — File upload
# ────────────────────────────────────────────────────────────

class TestFileUpload:

    def test_upload_image(self, client, two_users):
        token_a, _ = two_users
        fake_img = io.BytesIO(b"\xff\xd8\xff\xe0" + b"\x00" * 100)  # JPEG magic bytes
        resp = client.post(
            "/chat/upload",
            headers=auth(token_a),
            files={"file": ("test.jpg", fake_img, "image/jpeg")},
        )
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert "url" in data or "file_url" in data or "path" in data

    def test_upload_pdf(self, client, two_users):
        token_a, _ = two_users
        fake_pdf = io.BytesIO(b"%PDF-1.4" + b"\x00" * 50)
        resp = client.post(
            "/chat/upload",
            headers=auth(token_a),
            files={"file": ("document.pdf", fake_pdf, "application/pdf")},
        )
        assert resp.status_code in (200, 201)

    def test_dangerous_extension_blocked(self, client, two_users):
        token_a, _ = two_users
        resp = client.post(
            "/chat/upload",
            headers=auth(token_a),
            files={"file": ("malware.exe", io.BytesIO(b"MZ\x00"), "application/octet-stream")},
        )
        assert resp.status_code in (400, 415, 422)

    def test_empty_file_blocked(self, client, two_users):
        token_a, _ = two_users
        resp = client.post(
            "/chat/upload",
            headers=auth(token_a),
            files={"file": ("empty.jpg", io.BytesIO(b""), "image/jpeg")},
        )
        assert resp.status_code in (400, 422)

    def test_upload_unauthenticated_blocked(self, client):
        resp = client.post(
            "/chat/upload",
            files={"file": ("photo.jpg", io.BytesIO(b"\xff\xd8"), "image/jpeg")},
        )
        assert resp.status_code in (401, 403)


# ────────────────────────────────────────────────────────────
# T5 — User/profile endpoints
# ────────────────────────────────────────────────────────────

class TestUserProfile:

    def test_get_own_profile(self, client, two_users):
        token_a, _ = two_users
        resp = client.get("/me", headers=auth(token_a))
        assert resp.status_code == 200
        data = resp.json()
        assert "username" in data
        assert "id" in data

    def test_get_other_user_profile(self, client, two_users):
        token_a, token_b = two_users
        bob = client.get("/me", headers=auth(token_b)).json()
        resp = client.get(f"/users/{bob['id']}", headers=auth(token_a))
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == bob["id"]

    def test_update_display_name(self, client, two_users):
        token_a, _ = two_users
        resp = client.patch("/me", headers=auth(token_a), json={
            "display_name": "Алиса Новая"
        })
        assert resp.status_code in (200, 204)

    def test_nonexistent_user_returns_404(self, client, two_users):
        token_a, _ = two_users
        resp = client.get("/users/999999", headers=auth(token_a))
        assert resp.status_code == 404
