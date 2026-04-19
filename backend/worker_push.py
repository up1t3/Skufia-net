import os
import requests
from celery import Celery
from database import SessionLocal, FCMToken

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
FCM_SERVER_KEY = os.getenv("FCM_SERVER_KEY", "dummy_key")

celery_app = Celery(
    "skufia_push_worker",
    broker=REDIS_URL
)

@celery_app.task
def send_fcm_push(user_id: int, message_payload: dict):
    # Query database for user's FCM tokens
    db = SessionLocal()
    try:
        tokens = db.query(FCMToken).filter(FCMToken.user_id == user_id).all()
        if not tokens:
            return "No tokens found for user."

        registration_ids = [t.token for t in tokens]

        payload = {
            "registration_ids": registration_ids,
            "data": message_payload,
        }

        headers = {
            "Authorization": f"key={FCM_SERVER_KEY}",
            "Content-Type": "application/json",
        }

        # The actual URL might differ for v1 or legacy API.
        # This follows standard legacy payload syntax, which is still broadly accepted.
        response = requests.post(
            "https://fcm.googleapis.com/fcm/send",
            json=payload,
            headers=headers,
            timeout=5
        )

        return f"Status: {response.status_code}, Response: {response.text}"
    finally:
        db.close()
