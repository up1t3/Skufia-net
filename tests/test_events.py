import pytest
from datetime import datetime, timedelta

def test_create_event(client, auth_headers):
    event_date = (datetime.utcnow() + timedelta(days=7)).isoformat()
    payload = {
        "title": "Cyber-Industrial Meetup",
        "event_date": event_date,
        "location": "The Basement",
        "description": "BYOB and solder."
    }
    headers = {**auth_headers, "X-Idempotency-Key": "event-create-1"}
    response = client.post("/api/events", json=payload, headers=headers)
    assert response.status_code == 200
    assert "id" in response.json()
    assert response.json()["status"] == "Event broadcasted"

def test_get_events(client, auth_headers):
    # Ensure there's an event
    event_date = (datetime.utcnow() + timedelta(days=1)).isoformat()
    client.post("/api/events", json={
        "title": "Upcoming Event",
        "event_date": event_date,
        "location": "Everywhere",
        "description": "Join us."
    }, headers={**auth_headers, "X-Idempotency-Key": "event-create-2"})

    response = client.get("/api/events", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1
    assert any(e["title"] == "Upcoming Event" for e in response.json())
