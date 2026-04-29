import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
import os
import sys

# Add backend to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'backend')))

from database import Base, User, Profile
from main import app
import auth
import routers.wiki as wiki
import routers.forum as forum
import routers.events as events
from unittest.mock import AsyncMock, MagicMock

# Mock broadcast and redis_client before importing main
import broadcaster
import redis.asyncio as aioredis
mock_broadcast_obj = AsyncMock()
broadcaster.Broadcast = MagicMock(return_value=mock_broadcast_obj)
aioredis.from_url = MagicMock()

# SQLite in-memory database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session")
def db_engine():
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def db_session(db_engine):
    connection = db_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    # Pre-seed some data if necessary, or just yield
    yield session

    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture(scope="function")
def client(db_session, monkeypatch):
    # Mock redis_client in main
    import main
    monkeypatch.setattr(main, "redis_client", AsyncMock())
    monkeypatch.setattr(main, "broadcast", AsyncMock())
    # Mock broadcast in ws_manager
    import ws_manager
    monkeypatch.setattr(ws_manager, "broadcast", AsyncMock())

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    # List of modules that have get_db
    app.dependency_overrides[auth.get_db] = override_get_db
    app.dependency_overrides[wiki.get_db] = override_get_db
    app.dependency_overrides[forum.get_db] = override_get_db
    app.dependency_overrides[events.get_db] = override_get_db

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()

@pytest.fixture(scope="function")
def test_user(db_session):
    from auth import get_password_hash
    user = User(
        username="testuser",
        email="test@example.com",
        hashed_password=get_password_hash("testpassword"),
        accepted_pd=True
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    profile = Profile(user_id=user.id, nickname="TestSkuf")
    db_session.add(profile)
    db_session.commit()

    return user

@pytest.fixture(scope="function")
def auth_headers(test_user):
    from auth import create_access_token
    from datetime import timedelta
    access_token = create_access_token(
        data={"sub": test_user.username, "user_id": test_user.id},
        expires_delta=timedelta(minutes=15)
    )
    return {"Authorization": f"Bearer {access_token}"}
