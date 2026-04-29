import pytest
import uuid

def test_get_wiki_empty(client, auth_headers):
    response = client.get("/api/wiki", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == []

def test_create_wiki_article(client, auth_headers):
    idempotency_key = uuid.uuid4().hex
    headers = {**auth_headers, "X-Idempotency-Key": idempotency_key}
    article_data = {
        "title": "Test Article",
        "content": "This is a test wiki article content.",
        "category": "Testing"
    }
    response = client.post("/api/wiki", json=article_data, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "Article archived in the Great Library"

    # Verify article exists
    response = client.get("/api/wiki", headers=auth_headers)
    assert response.status_code == 200
    articles = response.json()
    assert len(articles) == 1
    assert articles[0]["title"] == "Test Article"
    return articles[0]["id"]

def test_create_wiki_idempotency(client, auth_headers):
    idempotency_key = uuid.uuid4().hex
    headers = {**auth_headers, "X-Idempotency-Key": idempotency_key}
    article_data = {
        "title": "Idempotent Article",
        "content": "Content",
        "category": "General"
    }
    # First request
    response = client.post("/api/wiki", json=article_data, headers=headers)
    assert response.status_code == 200

    # Second request with same key
    response = client.post("/api/wiki", json=article_data, headers=headers)
    assert response.status_code == 400
    assert "MSG_DUPLICATE_IDEMPOTENCY" in str(response.json())

def test_get_wiki_detail(client, auth_headers):
    # Create article first
    idempotency_key = uuid.uuid4().hex
    headers = {**auth_headers, "X-Idempotency-Key": idempotency_key}
    article_data = {"title": "Detail Test", "content": "Detailed content"}
    client.post("/api/wiki", json=article_data, headers=headers)

    articles = client.get("/api/wiki", headers=auth_headers).json()
    article_id = articles[0]["id"]

    response = client.get(f"/api/wiki/{article_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["title"] == "Detail Test"
    assert response.json()["content"] == "Detailed content"

def test_like_wiki_article(client, auth_headers):
    # Create article
    idempotency_key = uuid.uuid4().hex
    headers = {**auth_headers, "X-Idempotency-Key": idempotency_key}
    article_data = {"title": "Like Test", "content": "Content"}
    client.post("/api/wiki", json=article_data, headers=headers)

    articles = client.get("/api/wiki", headers=auth_headers).json()
    article_id = articles[0]["id"]

    # Like
    like_headers = {**auth_headers, "X-Idempotency-Key": uuid.uuid4().hex}
    response = client.post(f"/api/wiki/{article_id}/like", headers=like_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "liked"

    # Verify like count
    response = client.get(f"/api/wiki/{article_id}", headers=auth_headers)
    assert response.json()["likes"] == 1

    # Unlike (same endpoint toggles)
    unlike_headers = {**auth_headers, "X-Idempotency-Key": uuid.uuid4().hex}
    response = client.post(f"/api/wiki/{article_id}/like", headers=unlike_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "unliked"

    # Verify like count
    response = client.get(f"/api/wiki/{article_id}", headers=auth_headers)
    assert response.json()["likes"] == 0
