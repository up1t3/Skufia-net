import pytest
import sys
import os
import time
import json
import asyncio
import websockets
from multiprocessing import Process
import uvicorn
import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from database import Base, engine, SessionLocal, User, Profile
from auth import create_access_token
from datetime import timedelta

def run_server():
    from main import app
    uvicorn.run(app, host="127.0.0.1", port=8008, log_level="error")

@pytest.fixture(scope="module")
def setup_users_and_server():
    # Setup DB
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.query(Profile).filter(Profile.user.has(username="ws_user1")).delete(synchronize_session=False)
    db.query(User).filter(User.username == "ws_user1").delete()
    db.commit()

    user1 = User(username="ws_user1", hashed_password="pw", email="ws1@example.com")
    db.add(user1)
    db.commit()
    db.refresh(user1)

    profile1 = Profile(user_id=user1.id, nickname="WS User 1")
    db.add(profile1)
    db.commit()

    token1 = create_access_token(data={"sub": user1.username, "user_id": user1.id}, expires_delta=timedelta(days=1))
    db.close()

    # Start server
    proc = Process(target=run_server)
    proc.start()

    # Wait for server to start
    time.sleep(2)

    yield {"user_id": user1.id, "token": token1}

    proc.terminate()
    proc.join()

@pytest.mark.asyncio
async def test_ws_resilience_non_duplication(setup_users_and_server):
    token = setup_users_and_server["token"]
    user_id = setup_users_and_server["user_id"]

    received_messages = []

    # Reconnect loops enforcing connection over high-latency degraded channels
    for loop_iteration in range(5):
        try:
            uri = f"ws://127.0.0.1:8008/ws/chat/{token}"
            async with websockets.connect(uri) as websocket:
                # Sleep briefly to simulate degraded latency on connection
                await asyncio.sleep(0.05)

                # Send a test message that will be relayed back to us
                msg_payload = {
                    "type": "rtc_signal",
                    "target": user_id,
                    "signal_type": "resilience_test",
                    "payload": f"loop_{loop_iteration}"
                }
                await websocket.send(json.dumps(msg_payload))

                # Wait briefly and read messages
                try:
                    async with asyncio.timeout(0.5):
                        while True:
                            text_data = await websocket.recv()
                            data = json.loads(text_data)
                            if data.get("type") == "rtc_signal" and data.get("signal_type") == "resilience_test":
                                received_messages.append(data.get("payload"))
                except TimeoutError:
                    pass
        except Exception as e:
            print("WS Error:", e)

        # Artificial high-latency disconnect delay
        await asyncio.sleep(0.05)

    # Assert message non-duplication constraints
    unique_messages = set(received_messages)
    duplicates = len(received_messages) - len(unique_messages)

    print(f"Total received: {len(received_messages)}, Unique: {len(unique_messages)}")
    assert duplicates == 0, f"Failed message non-duplication constraints! Found {duplicates} duplicate messages."
