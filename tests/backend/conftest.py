import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

# Import the actual models and app
from backend.database import Base
import backend.routes as routes

# Use SQLite in-memory or a test file for isolation
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

    # Here we override the dependency from routes.py 
    routes.app.dependency_overrides[routes.get_db] = override_get_db
    
    with TestClient(routes.app) as c:
        yield c
    
    routes.app.dependency_overrides.clear()
