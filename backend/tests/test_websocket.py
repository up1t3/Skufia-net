import pytest
from fastapi.testclient import TestClient
import json
import asyncio

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app
from database import Base, engine, SessionLocal, User, Profile
from auth import get_password_hash

# Set up test database
Base.metadata.create_all(bind=engine)

@pytest.fixture(scope="module")
def setup_db():
    db = SessionLocal()
    # Create test user 1
    db.query(Profile).filter(Profile.user.has(username="ws_user1")).delete(synchronize_session=False)
    db.query(User).filter(User.username == "ws_user1").delete()

    # Create test user 2
    db.query(Profile).filter(Profile.user.has(username="ws_user2")).delete(synchronize_session=False)
    db.query(User).filter(User.username == "ws_user2").delete()
    db.commit()

    u1 = User(username="ws_user1", email="ws1@test.com", hashed_password=get_password_hash("pass"))
    u2 = User(username="ws_user2", email="ws2@test.com", hashed_password=get_password_hash("pass"))
    db.add_all([u1, u2])
    db.commit()
    db.refresh(u1)
    db.refresh(u2)

    p1 = Profile(user_id=u1.id, is_online=False)
    p2 = Profile(user_id=u2.id, is_online=False)
    db.add_all([p1, p2])
    db.commit()

    yield {"u1": u1, "u2": u2}

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c

def get_token(client, username):
    response = client.post("/api/auth/login", json={"username": username, "password": "pass"})
    return response.json()["access_token"]

def test_websocket_connect_disconnect(client, setup_db):
    u1_id = setup_db["u1"].id
    token = get_token(client, "ws_user1")

    db = SessionLocal()
    p1_before = db.query(Profile).filter(Profile.user_id == u1_id).first()
    assert not p1_before.is_online
    db.close()

    with client.websocket_connect(f"/ws/chat/{token}") as websocket:
        db = SessionLocal()
        p1_during = db.query(Profile).filter(Profile.user_id == u1_id).first()
        assert p1_during.is_online
        db.close()

    db = SessionLocal()
    p1_after = db.query(Profile).filter(Profile.user_id == u1_id).first()
    assert not p1_after.is_online
    db.close()

def test_websocket_typing_indicator(client, setup_db):
    token1 = get_token(client, "ws_user1")
    token2 = get_token(client, "ws_user2")
    u1_id = setup_db["u1"].id
    u2_id = setup_db["u2"].id

    # connect ws2 first so it's ready to receive
    with client.websocket_connect(f"/ws/chat/{token2}") as ws2:
        # consume any initial messages if needed
        # ws2.receive_text()

        with client.websocket_connect(f"/ws/chat/{token1}") as ws1:
            ws1.send_text(json.dumps({
                "type": "typing_indicator",
                "target": u2_id,
                "typing": True
            }))

            # check if ws2 received the typing indicator
            received_msg = json.loads(ws2.receive_text())
            assert received_msg["type"] == "typing_indicator"
            assert received_msg["sender_id"] == u1_id
            assert received_msg["typing"] == True

def test_websocket_read_receipts(client, setup_db):
    token1 = get_token(client, "ws_user1")
    token2 = get_token(client, "ws_user2")
    u1_id = setup_db["u1"].id
    u2_id = setup_db["u2"].id

    with client.websocket_connect(f"/ws/chat/{token2}") as ws2:
        with client.websocket_connect(f"/ws/chat/{token1}") as ws1:
            ws1.send_text(json.dumps({
                "type": "read_receipt",
                "target": u2_id,
                "message_id": 123,
                "room_id": 456
            }))

            received_msg = json.loads(ws2.receive_text())
            assert received_msg["type"] == "read_receipt"
            assert received_msg["sender_id"] == u1_id
            assert received_msg["message_id"] == 123
            assert received_msg["room_id"] == 456
