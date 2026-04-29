import pytest
import uuid
from database import Category

def test_get_categories(client, auth_headers, db_session):
    # Add a category
    cat = Category(name="General", description="General discussion", order=1)
    db_session.add(cat)
    db_session.commit()

    response = client.get("/api/categories", headers=auth_headers)
    assert response.status_code == 200
    categories = response.json()
    assert len(categories) >= 1
    assert any(c["name"] == "General" for c in categories)

def test_create_topic(client, auth_headers, db_session):
    cat = Category(name="Tech", description="Tech talk", order=2)
    db_session.add(cat)
    db_session.commit()
    cat_id = cat.id

    idempotency_key = uuid.uuid4().hex
    headers = {**auth_headers, "X-Idempotency-Key": idempotency_key}
    topic_data = {
        "title": "New Tech Topic",
        "category_id": cat_id
    }
    response = client.post("/api/topics", json=topic_data, headers=headers)
    assert response.status_code == 200
    assert "id" in response.json()
    assert "Carrier signal established" in response.json()["status"]

    topic_id = response.json()["id"]

    # Verify topic exists
    response = client.get("/api/topics", headers=auth_headers)
    assert response.status_code == 200
    topics = response.json()
    assert any(t["id"] == topic_id for t in topics)

def test_reply_to_topic(client, auth_headers, db_session):
    cat = Category(name="Gaming", description="Gaming talk", order=3)
    db_session.add(cat)
    db_session.commit()

    topic_headers = {**auth_headers, "X-Idempotency-Key": uuid.uuid4().hex}
    topic_res = client.post("/api/topics", json={"title": "Game on", "category_id": cat.id}, headers=topic_headers)
    topic_id = topic_res.json()["id"]

    idempotency_key = uuid.uuid4().hex
    headers = {**auth_headers, "X-Idempotency-Key": idempotency_key}
    reply_data = {"content": "I love this game!"}
    response = client.post(f"/api/topics/{topic_id}/reply", json=reply_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "Message transmitted to topic thread"

    # Get posts
    response = client.get(f"/api/topics/{topic_id}/posts", headers=auth_headers)
    assert response.status_code == 200
    posts = response.json()
    assert len(posts) == 1
    assert posts[0]["content"] == "I love this game!"
    return posts[0]["id"]

def test_like_post(client, auth_headers, db_session):
    cat = Category(name="Cars", description="Car talk", order=4)
    db_session.add(cat)
    db_session.commit()

    topic_headers = {**auth_headers, "X-Idempotency-Key": uuid.uuid4().hex}
    topic_res = client.post("/api/topics", json={"title": "Vroom vroom", "category_id": cat.id}, headers=topic_headers)
    topic_id = topic_res.json()["id"]

    reply_headers = {**auth_headers, "X-Idempotency-Key": uuid.uuid4().hex}
    client.post(f"/api/topics/{topic_id}/reply", json={"content": "Cool car"}, headers=reply_headers)

    posts = client.get(f"/api/topics/{topic_id}/posts", headers=auth_headers).json()
    post_id = posts[0]["id"]

    # Like
    like_headers = {**auth_headers, "X-Idempotency-Key": uuid.uuid4().hex}
    response = client.post(f"/api/posts/{post_id}/like", headers=like_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "liked"

    # Verify like count
    posts = client.get(f"/api/topics/{topic_id}/posts", headers=auth_headers).json()
    assert posts[0]["likes"] == 1

    # Unlike
    unlike_headers = {**auth_headers, "X-Idempotency-Key": uuid.uuid4().hex}
    response = client.post(f"/api/posts/{post_id}/like", headers=unlike_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "unliked"

    # Verify like count
    posts = client.get(f"/api/topics/{topic_id}/posts", headers=auth_headers).json()
    assert posts[0]["likes"] == 0
