import json
import random
import time
import uuid
import websocket
from locust import User, task, between, events

class WebSocketUser(User):
    wait_time = between(5, 5)

    def on_start(self):
        self.user_id = str(uuid.uuid4())
        # To match the user's requirement: `ws://localhost:8000/ws/{user_id}`
        self.ws_url = f"ws://localhost:8000/ws/{self.user_id}"

        try:
            start_time = time.time()
            self.ws = websocket.create_connection(self.ws_url)
            events.request.fire(
                request_type="ws_connect",
                name="connect",
                response_time=int((time.time() - start_time) * 1000),
                response_length=0,
                exception=None,
            )
        except Exception as e:
            events.request.fire(
                request_type="ws_connect",
                name="connect",
                response_time=int((time.time() - start_time) * 1000),
                response_length=0,
                exception=e,
            )

    def on_stop(self):
        if hasattr(self, 'ws') and self.ws:
            self.ws.close()
            events.request.fire(
                request_type="ws_close",
                name="close",
                response_time=0,
                response_length=0,
                exception=None,
            )

    @task
    def send_message(self):
        if not hasattr(self, 'ws') or not self.ws:
            return

        message = {
            "type": "ping",
            "message": "Hello from locust!"
        }
        json_message = json.dumps(message)

        start_time = time.time()

        # Simulating a 5% packet drop (Chaos Testing)
        if random.random() < 0.05:
            events.request.fire(
                request_type="ws_send",
                name="send_json",
                response_time=int((time.time() - start_time) * 1000),
                response_length=0,
                exception=Exception("Chaos Proxy: Simulated Packet Drop"),
            )
            return

        try:
            self.ws.send(json_message)
            events.request.fire(
                request_type="ws_send",
                name="send_json",
                response_time=int((time.time() - start_time) * 1000),
                response_length=len(json_message),
                exception=None,
            )
        except Exception as e:
            events.request.fire(
                request_type="ws_send",
                name="send_json",
                response_time=int((time.time() - start_time) * 1000),
                response_length=0,
                exception=e,
            )
