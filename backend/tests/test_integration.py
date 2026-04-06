import pytest
from fastapi.testclient import TestClient
import sys
import os

# Ensure backend module can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app
from database import Base, engine, SessionLocal, User, Profile
from auth import get_password_hash

# Set up test database
Base.metadata.create_all(bind=engine)

@pytest.fixture(scope="module")
def client():
    # Provide a test client
    with TestClient(app) as c:
        yield c

@pytest.fixture(scope="module")
def setup_db():
    db = SessionLocal()
    # Clean previous test user if any
    db.query(Profile).filter(Profile.user.has(username="test_user")).delete(synchronize_session=False)
    db.query(User).filter(User.username == "test_user").delete()
    db.commit()
    
    # Create test user
    test_user = User(
        username="test_user", 
        email="test@skufia.net", 
        hashed_password=get_password_hash("password123")
    )
    db.add(test_user)
    db.commit()
    db.refresh(test_user)
    
    test_profile = Profile(user_id=test_user.id, rank="Junior", bio="Test bio")
    db.add(test_profile)
    db.commit()
    
    yield test_user
    
    # Teardown
    db.query(Profile).filter(Profile.user_id == test_user.id).delete()
    db.query(User).filter(User.id == test_user.id).delete()
    db.commit()
    db.close()

@pytest.fixture(scope="module")
def auth_headers(client, setup_db):
    response = client.post("/api/auth/login", json={
        "username": "test_user",
        "password": "password123"
    })
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_get_wiki_public(client):
    response = client.get("/api/wiki")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_get_my_profile(client, auth_headers):
    response = client.get("/api/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "test_user"
    assert data["rank"] == "Junior"

def test_update_profile(client, auth_headers):
    response = client.post("/api/me/update", headers=auth_headers, json={
        "avatar_url": "SPRITE:/img/avatars.png:4"
    })
    assert response.status_code == 200
    
    response = client.get("/api/me", headers=auth_headers)
    assert response.json()["avatar_url"] == "SPRITE:/img/avatars.png:4"

def test_create_and_get_topic(client, auth_headers):
    # Test topic creation
    response = client.post("/api/topics", headers=auth_headers, json={
        "title": "Test Topic Integration",
        "category_id": 1
    })
    assert response.status_code == 200
    topic_id = response.json()["id"]

    # Test reading topics
    response = client.get("/api/topics")
    assert response.status_code == 200
    topics = response.json()
    assert isinstance(topics, list)
    assert any(t["id"] == topic_id for t in topics)

    # Test posting reply
    response = client.post(f"/api/topics/{topic_id}/reply", headers=auth_headers, json={
        "content": "A test reply"
    })
    assert response.status_code == 200

    # Test reading posts
    response = client.get(f"/api/topics/{topic_id}/posts")
    assert response.status_code == 200
    posts = response.json()
    assert isinstance(posts, list)
    assert len(posts) > 0

def test_registry(client):
    response = client.get("/api/registry")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    if len(data) > 0:
        assert "username" in data[0]

def test_chat_rooms(client, auth_headers):
    response = client.get("/api/chat/rooms", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_auth_failures(client):
    # Invalid token decode
    response = client.get("/api/me", headers={"Authorization": "Bearer invalidtoken"})
    assert response.status_code == 401
    
    # Login incorrect password
    response = client.post("/api/auth/login", json={"username": "test_user", "password": "wrong"})
    assert response.status_code == 401
    
    # Login unregistered user
    response = client.post("/api/auth/login", json={"username": "ghost_user", "password": "abc"})
    assert response.status_code == 401

def test_register_flow(client):
    # Register new
    response = client.post("/api/auth/register", json={
        "username": "new_guy",
        "email": "new@guy.net",
        "password": "secret_password"
    })
    assert response.status_code == 201
    
    # Register existing username
    response = client.post("/api/auth/register", json={
        "username": "new_guy",
        "email": "new2@guy.net",
        "password": "secret_password"
    })
    assert response.status_code == 400
    
    # Register existing email
    response = client.post("/api/auth/register", json={
        "username": "new_guy_3",
        "email": "new@guy.net",
        "password": "secret_password"
    })
    assert response.status_code == 400

def test_chat_file_upload_success(client, auth_headers):
    # Test uploading a valid small text file (mimicking chat attachment)
    file_content = b"Hello, this is a test chat file attachment."
    files = {"file": ("test_attach.txt", file_content, "text/plain")}
    response = client.post("/api/chat/upload", headers=auth_headers, files=files)
    assert response.status_code == 200
    data = response.json()
    assert "file_url" in data
    assert data["original_name"] == "test_attach.txt"
    assert data["size"] == len(file_content)

def test_chat_file_upload_too_large(client, auth_headers):
    # Test uploading a file over the 5MB limit
    file_content = b"0" * ((5 * 1024 * 1024) + 10)  # 5 MB + 10 bytes
    files = {"file": ("large_attach.bin", file_content, "application/octet-stream")}
    response = client.post("/api/chat/upload", headers=auth_headers, files=files)
    assert response.status_code == 413

def test_market_create_and_get(client, auth_headers):
    # Create market listing
    payload = {
        "title": "Avito Скуф-Тест",
        "price": "1000",
        "description": "Тестовое описание",
        "category": "Электроника",
        "location": "Скуфград"
    }
    response = client.post("/api/market", headers=auth_headers, json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "Listing active" in data["status"]
    item_id = data["id"]
    
    # Get listings
    response = client.get("/api/market?category=Электроника&location=Скуфград", headers=auth_headers)
    assert response.status_code == 200
    listings = response.json()
    assert len(listings) > 0
    assert listings[0]["title"] == "Avito Скуф-Тест"
    
    # Delete listing
    response = client.delete(f"/api/market/{item_id}", headers=auth_headers)
    assert response.status_code == 200
    
    # Verify deletion
    response = client.get("/api/market?category=Электроника&location=Скуфград", headers=auth_headers)
    assert len(response.json()) == 0

def test_events_create_and_get(client, auth_headers):
    payload = {
        "title": "Пивная сходка",
        "event_date": "2026-12-31T20:00:00Z",
        "location": "Бар у дома",
        "description": "Сбор скуфов"
    }
    response = client.post("/api/events", headers=auth_headers, json=payload)
    assert response.status_code == 200
    
    response = client.get("/api/events", headers=auth_headers)
    assert response.status_code == 200
    events = response.json()
    assert any(e["title"] == "Пивная сходка" for e in events)

def test_private_chat_create(client, auth_headers):
    # we assume target_user_id=1 exists because we login as testuser
    # Wait, our auth_headers are for 'testuser'. Let's find out testuser ID
    r_me = client.get("/api/me", headers=auth_headers)
    my_id = r_me.json()["id"]
    
    response = client.post("/api/chat/private", headers=auth_headers, json={"target_user_id": my_id})
    assert response.status_code == 200
    data = response.json()
    assert data["room_type"] == "private"
    assert "test_user" in data["name"]
