import pytest
from database import Category

@pytest.fixture
def forum_category(db):
    cat = Category(name="Hardware", description="All about chips and wires", order=1)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat

def test_list_categories(client, auth_headers, forum_category):
    response = client.get("/api/categories", headers=auth_headers)
    assert response.status_code == 200
    assert any(c["name"] == "Hardware" for c in response.json())

def test_create_topic(client, auth_headers, forum_category):
    payload = {
        "title": "My first topic",
        "category_id": forum_category.id
    }
    headers = {**auth_headers, "X-Idempotency-Key": "topic-create-1"}
    response = client.post("/api/topics", json=payload, headers=headers)
    assert response.status_code == 200
    assert "id" in response.json()
    assert "status" in response.json()

def test_list_topics(client, auth_headers, forum_category):
    # Ensure there's a topic
    client.post("/api/topics", json={
        "title": "Topic for listing",
        "category_id": forum_category.id
    }, headers={**auth_headers, "X-Idempotency-Key": "topic-create-2"})

    response = client.get("/api/topics", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1
    assert any(t["title"] == "Topic for listing" for t in response.json())

def test_reply_to_topic(client, auth_headers, forum_category):
    # Create a topic first
    create_response = client.post("/api/topics", json={
        "title": "Topic to reply",
        "category_id": forum_category.id
    }, headers={**auth_headers, "X-Idempotency-Key": "topic-create-3"})
    topic_id = create_response.json()["id"]

    payload = {"content": "This is a reply"}
    headers = {**auth_headers, "X-Idempotency-Key": "reply-create-1"}
    response = client.post(f"/api/topics/{topic_id}/reply", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "Message transmitted to topic thread"

def test_get_posts(client, auth_headers, forum_category):
    # Create topic and reply
    create_response = client.post("/api/topics", json={
        "title": "Topic with posts",
        "category_id": forum_category.id
    }, headers={**auth_headers, "X-Idempotency-Key": "topic-create-4"})
    topic_id = create_response.json()["id"]

    client.post(f"/api/topics/{topic_id}/reply", json={"content": "Reply 1"},
                headers={**auth_headers, "X-Idempotency-Key": "reply-create-2"})

    response = client.get(f"/api/topics/{topic_id}/posts", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1
    assert response.json()[0]["content"] == "Reply 1"
