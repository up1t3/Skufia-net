import pytest
from unittest.mock import patch, MagicMock
from worker_push import send_fcm_push

@patch('worker_push.SessionLocal')
@patch('worker_push.requests.post')
@patch('worker_push.FCM_SERVER_KEY', 'dummy_key')
def test_send_fcm_push_success(mock_post, mock_session_local):
    # Mock db session and tokens
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db

    mock_token1 = MagicMock()
    mock_token1.token = "token1"
    mock_token2 = MagicMock()
    mock_token2.token = "token2"

    # Setup query chaining
    mock_db.query.return_value.filter.return_value.all.return_value = [mock_token1, mock_token2]

    # Mock request response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.text = '{"success": 2, "failure": 0}'
    mock_post.return_value = mock_response

    # Run function
    result = send_fcm_push(user_id=1, message_payload={"title": "Test", "body": "Hello"})

    # Assertions
    assert result == 'Status: 200, Response: {"success": 2, "failure": 0}'
    mock_post.assert_called_once_with(
        "https://fcm.googleapis.com/fcm/send",
        json={
            "registration_ids": ["token1", "token2"],
            "data": {"title": "Test", "body": "Hello"}
        },
        headers={
            "Authorization": "key=dummy_key",
            "Content-Type": "application/json"
        },
        timeout=5
    )
    mock_db.close.assert_called_once()

@patch('worker_push.SessionLocal')
@patch('worker_push.requests.post')
def test_send_fcm_push_no_tokens(mock_post, mock_session_local):
    # Mock db session and tokens
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db

    # Setup query chaining to return empty list
    mock_db.query.return_value.filter.return_value.all.return_value = []

    # Run function
    result = send_fcm_push(user_id=1, message_payload={"title": "Test", "body": "Hello"})

    # Assertions
    assert result == "No tokens found for user."
    mock_post.assert_not_called()
    mock_db.close.assert_called_once()

@patch('worker_push.SessionLocal')
@patch('worker_push.requests.post')
def test_send_fcm_push_request_exception(mock_post, mock_session_local):
    # Mock db session and tokens
    mock_db = MagicMock()
    mock_session_local.return_value = mock_db

    mock_token = MagicMock()
    mock_token.token = "token1"

    # Setup query chaining
    mock_db.query.return_value.filter.return_value.all.return_value = [mock_token]

    # Mock request to raise exception
    mock_post.side_effect = Exception("Connection error")

    # Run function and expect exception to be raised
    with pytest.raises(Exception, match="Connection error"):
        send_fcm_push(user_id=1, message_payload={"title": "Test", "body": "Hello"})

    # Assertions
    mock_post.assert_called_once()
    mock_db.close.assert_called_once()
