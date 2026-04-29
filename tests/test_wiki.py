import pytest

@pytest.fixture
def wiki_article(client, auth_headers):
    payload = {
        "title": "Initial Article",
        "content": "Initial content",
        "category": "General"
    }
    headers = {**auth_headers, "X-Idempotency-Key": "wiki-init-1"}
    response = client.post("/api/wiki", json=payload, headers=headers)
    return response.json()

def test_create_wiki_article(client, auth_headers):
    payload = {
        "title": "Cyber-Industrial Survival Guide",
        "content": "Step 1: Don't panic. Step 2: Find a wrench.",
        "category": "Survival"
    }
    headers = {**auth_headers, "X-Idempotency-Key": "wiki-create-unique-1"}
    response = client.post("/api/wiki", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "Article archived in the Great Library"

def test_get_wiki_articles(client, auth_headers, wiki_article):
    response = client.get("/api/wiki", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1
    assert any(a["title"] == "Initial Article" for a in response.json())

def test_get_wiki_article_detail(client, auth_headers, wiki_article):
    # Find the article we just created via fixture
    list_response = client.get("/api/wiki", headers=auth_headers)
    # Filter for the one from fixture to be sure
    article = next(a for a in list_response.json() if a["title"] == "Initial Article")
    article_id = article["id"]

    response = client.get(f"/api/wiki/{article_id}", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["title"] == "Initial Article"
    assert response.json()["content"] == "Initial content"

def test_like_wiki_article(client, auth_headers, wiki_article):
    # Find the article
    list_response = client.get("/api/wiki", headers=auth_headers)
    article = next(a for a in list_response.json() if a["title"] == "Initial Article")
    article_id = article["id"]

    headers = {**auth_headers, "X-Idempotency-Key": "wiki-like-unique-1"}
    response = client.post(f"/api/wiki/{article_id}/like", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "liked"

    # Test unliking
    headers = {**auth_headers, "X-Idempotency-Key": "wiki-like-unique-2"}
    response = client.post(f"/api/wiki/{article_id}/like", headers=headers)
    assert response.status_code == 200
    assert response.json()["status"] == "unliked"
