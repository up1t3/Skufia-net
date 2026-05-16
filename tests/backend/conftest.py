import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

import sys
import os
os.environ["TESTING"] = "1"
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../backend')))

# Import the actual models and app
from database import Base
import main
import database
import auth

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_skufia.db"

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
    yield session
    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    from routers import chat, registry, market, forum, events, notifications, wiki

    # Here we override the dependency from auth.py and other routers
    main.app.dependency_overrides[auth.get_db] = override_get_db
    main.app.dependency_overrides[chat.get_db] = override_get_db
    main.app.dependency_overrides[registry.get_db] = override_get_db
    main.app.dependency_overrides[market.get_db] = override_get_db
    main.app.dependency_overrides[forum.get_db] = override_get_db
    main.app.dependency_overrides[events.get_db] = override_get_db
    main.app.dependency_overrides[notifications.get_db] = override_get_db
    main.app.dependency_overrides[wiki.get_db] = override_get_db
    with TestClient(main.app, base_url="http://testserver/api") as c:
        yield c
    
    main.app.dependency_overrides.clear()
