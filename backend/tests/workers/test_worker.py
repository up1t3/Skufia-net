import pytest
from unittest.mock import patch, MagicMock
from io import BytesIO
from worker import compute_blurhash

@patch('worker.redis_client')
@patch('worker.blurhash.encode')
@patch('worker.Image.open')
@patch('worker.requests.get')
def test_compute_blurhash_url_success(mock_get, mock_image_open, mock_blurhash_encode, mock_redis_client):
    # Setup mocks
    mock_response = MagicMock()
    mock_response.content = b"fake_image_data"
    mock_get.return_value = mock_response

    mock_image = MagicMock()
    mock_image.mode = "RGB"
    mock_image_open.return_value = mock_image

    mock_blurhash_encode.return_value = "fake_blurhash"

    # Run function
    result = compute_blurhash("http://example.com/image.jpg")

    # Assertions
    assert result == "fake_blurhash"
    mock_get.assert_called_once_with("http://example.com/image.jpg", timeout=10)
    mock_response.raise_for_status.assert_called_once()
    mock_image_open.assert_called_once()
    mock_image.thumbnail.assert_called_once_with((100, 100))
    mock_blurhash_encode.assert_called_once()
    mock_redis_client.set.assert_called_once_with("blurhash:http://example.com/image.jpg", "fake_blurhash")

@patch('worker.redis_client')
@patch('worker.blurhash.encode')
@patch('worker.Image.open')
def test_compute_blurhash_local_path_success(mock_image_open, mock_blurhash_encode, mock_redis_client):
    # Setup mocks
    mock_image = MagicMock()
    mock_image.mode = "RGB"
    mock_image_open.return_value = mock_image

    mock_blurhash_encode.return_value = "fake_blurhash_local"

    # Run function
    result = compute_blurhash("/path/to/local/image.jpg")

    # Assertions
    assert result == "fake_blurhash_local"
    mock_image_open.assert_called_once_with("/path/to/local/image.jpg")
    mock_image.thumbnail.assert_called_once_with((100, 100))
    mock_blurhash_encode.assert_called_once()
    mock_redis_client.set.assert_called_once_with("blurhash:/path/to/local/image.jpg", "fake_blurhash_local")

@patch('worker.redis_client')
@patch('worker.blurhash.encode')
@patch('worker.Image.open')
@patch('worker.requests.get')
def test_compute_blurhash_rgba_conversion(mock_get, mock_image_open, mock_blurhash_encode, mock_redis_client):
    # Setup mocks
    mock_response = MagicMock()
    mock_response.content = b"fake_image_data"
    mock_get.return_value = mock_response

    mock_image = MagicMock()
    mock_image.mode = "RGBA"
    mock_image_converted = MagicMock()
    mock_image.convert.return_value = mock_image_converted
    mock_image_open.return_value = mock_image

    mock_blurhash_encode.return_value = "fake_blurhash_rgba"

    # Run function
    result = compute_blurhash("https://example.com/image.png")

    # Assertions
    assert result == "fake_blurhash_rgba"
    mock_image.convert.assert_called_once_with("RGB")
    mock_image_converted.thumbnail.assert_called_once_with((100, 100))
    mock_redis_client.set.assert_called_once_with("blurhash:https://example.com/image.png", "fake_blurhash_rgba")

@patch('worker.requests.get')
def test_compute_blurhash_request_exception(mock_get):
    # Setup mock to raise exception
    mock_get.side_effect = Exception("Network error")

    # Run function
    result = compute_blurhash("http://example.com/fail.jpg")

    # Assertions
    assert result is None

@patch('worker.Image.open')
def test_compute_blurhash_image_open_exception(mock_image_open):
    # Setup mock to raise exception
    mock_image_open.side_effect = Exception("File not found")

    # Run function
    result = compute_blurhash("/invalid/path.jpg")

    # Assertions
    assert result is None
