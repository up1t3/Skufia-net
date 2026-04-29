import pytest
import os
import sys
import uuid
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, AsyncMock

# Add backend to sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))

# Set DATABASE_URL before importing backend.database
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_skufia.db"
os.environ["DATABASE_URL"] = SQLALCHEMY_DATABASE_URL

import main
from database import Base, User, Profile, engine, SessionLocal
from auth import get_db, create_access_token, get_password_hash

@pytest.fixture(scope="session", autouse=True)
def setup_database():
    # Mock redis and broadcast before importing/running main app
    main.redis_client = AsyncMock()
    main.broadcast = AsyncMock()
    main.broadcast.connect = AsyncMock()
    main.broadcast.disconnect = AsyncMock()

    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    if os.path.exists("./test_skufia.db"):
        os.remove("./test_skufia.db")

@pytest.fixture
def db():
    session = SessionLocal()
    yield session
    session.close()

@pytest.fixture
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    main.app.dependency_overrides[get_db] = override_get_db
    with TestClient(main.app) as c:
        yield c
    main.app.dependency_overrides.clear()

@pytest.fixture
def test_user(db):
    uid = str(uuid.uuid4())[:8]
    username = f"user_{uid}"
    email = f"{uid}@example.com"
    password = "testpassword"
    hashed_password = get_password_hash(password)

    user = User(
        username=username,
        email=email,
        hashed_password=hashed_password,
        accepted_pd=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Check if profile already exists
    profile = db.query(Profile).filter(Profile.user_id == user.id).first()
    if not profile:
        profile = Profile(user_id=user.id, nickname=f"Tester_{uid}")
        db.add(profile)
        db.commit()
    else:
        profile.nickname = f"Tester_{uid}"
        db.commit()

    return user

@pytest.fixture
def auth_headers(test_user):
    access_token = create_access_token(
        data={"sub": test_user.username, "user_id": test_user.id}
    )
    return {"Authorization": f"Bearer {access_token}"}
