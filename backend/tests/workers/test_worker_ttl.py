import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta
from worker_ttl import delete_expired_messages

@patch('worker_ttl.SessionLocal')
@patch('worker_ttl.datetime')
def test_delete_expired_messages_success(mock_datetime, mock_session_local):
    # Setup mocks
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db

    current_time = datetime(2023, 1, 1, 12, 0, 0)
    mock_datetime.utcnow.return_value = current_time

    # Message 1: Expired (created 2 hours ago, ttl 1 hour)
    msg1 = MagicMock()
    msg1.created_at = current_time - timedelta(hours=2)
    msg1.ttl_seconds = 3600
    msg1.is_deleted_for_all = False

    # Message 2: Not expired (created 30 mins ago, ttl 1 hour)
    msg2 = MagicMock()
    msg2.created_at = current_time - timedelta(minutes=30)
    msg2.ttl_seconds = 3600
    msg2.is_deleted_for_all = False

    # Message 3: Missing created_at (should be skipped)
    msg3 = MagicMock()
    msg3.created_at = None
    msg3.ttl_seconds = 3600
    msg3.is_deleted_for_all = False

    # Setup query chaining
    mock_db.query.return_value.filter.return_value.all.return_value = [msg1, msg2, msg3]

    # Run function
    delete_expired_messages()

    # Assertions
    assert msg1.is_deleted_for_all is True
    assert msg2.is_deleted_for_all is False
    assert msg3.is_deleted_for_all is False

    mock_db.commit.assert_called_once()
    mock_db.close.assert_called_once()

@patch('worker_ttl.SessionLocal')
@patch('worker_ttl.datetime')
def test_delete_expired_messages_none_expired(mock_datetime, mock_session_local):
    # Setup mocks
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db

    current_time = datetime(2023, 1, 1, 12, 0, 0)
    mock_datetime.utcnow.return_value = current_time

    # Message: Not expired
    msg1 = MagicMock()
    msg1.created_at = current_time - timedelta(minutes=30)
    msg1.ttl_seconds = 3600
    msg1.is_deleted_for_all = False

    # Setup query chaining
    mock_db.query.return_value.filter.return_value.all.return_value = [msg1]

    # Run function
    delete_expired_messages()

    # Assertions
    assert msg1.is_deleted_for_all is False
    mock_db.commit.assert_not_called()
    mock_db.close.assert_called_once()

@patch('worker_ttl.SessionLocal')
def test_delete_expired_messages_exception(mock_session_local):
    # Setup mocks
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db

    # Setup query to raise exception
    mock_db.query.side_effect = Exception("Database error")

    # Run function
    delete_expired_messages()

    # Assertions
    mock_db.rollback.assert_called_once()
    mock_db.close.assert_called_once()
