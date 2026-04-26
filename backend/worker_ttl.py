import os
from celery import Celery
from datetime import datetime, timedelta
from database import SessionLocal, Message
from sqlalchemy import or_

# We will use Redis as the Celery broker.
broker_url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
app = Celery('worker_ttl', broker=broker_url)

app.conf.beat_schedule = {
    'delete-expired-messages-every-minute': {
        'task': 'worker_ttl.delete_expired_messages',
        'schedule': 60.0,
    },
}
app.conf.timezone = 'UTC'

@app.task
def delete_expired_messages():
    db = SessionLocal()
    try:
        current_time = datetime.utcnow()
        # Find messages that have a TTL and are not already deleted
        messages = db.query(Message).filter(
            Message.ttl_seconds.isnot(None),
            or_(Message.is_deleted_for_all == False, Message.is_deleted_for_all.is_(None))
        ).all()

        deleted_count = 0
        for msg in messages:
            # Check if created_at + ttl_seconds < current_time
            if msg.created_at and msg.ttl_seconds:
                expiration_time = msg.created_at + timedelta(seconds=msg.ttl_seconds)
                if expiration_time <= current_time:
                    msg.is_deleted_for_all = True
                    deleted_count += 1

        if deleted_count > 0:
            db.commit()
            print(f"TTL Worker: Marked {deleted_count} messages as deleted_for_all.")
    except Exception as e:
        db.rollback()
        print(f"TTL Worker Error: {e}")
    finally:
        db.close()
