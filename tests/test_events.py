import pytest
import uuid
from datetime import datetime, timedelta

def test_get_events_empty(client, auth_headers):
    response = client.get("/api/events", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []

def test_create_event(client, auth_headers):
    idempotency_key = uuid.uuid4().hex
    headers = {**auth_headers, "X-Idempotency-Key": idempotency_key}

    event_date = (datetime.utcnow() + timedelta(days=1)).isoformat()
    event_data = {
        "title": "Cyber-Industrial Meetup",
        "event_date": event_date,
        "location": "Sector 7G",
        "description": "Annual gathering of the Skuf clan."
    }

    response = client.post("/api/events", json=event_data, headers=headers)
    assert response.status_code == 200
    assert "id" in response.json()
    assert response.json()["status"] == "Event broadcasted"

    # Verify event exists
    response = client.get("/api/events", headers=auth_headers)
    assert response.status_code == 200
    events = response.json()
    assert len(events) == 1
    assert events[0]["title"] == "Cyber-Industrial Meetup"
