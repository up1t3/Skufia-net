import pytest
from unittest.mock import patch
from routes import MAX_FILE_SIZE, MAX_AUDIO_SIZE

@pytest.fixture(autouse=True)
def mock_s3():
    with patch("aws_s3.aioboto3.Session") as mock_session:
        yield mock_session

def test_chat_file_upload_success(client, auth_headers):
    file_content = b"Hello, this is a test chat file attachment."
    files = {"file": ("test_attach.txt", file_content, "text/plain")}
    response = client.post("/api/chat/upload", headers=auth_headers, files=files)
    assert response.status_code == 200

def test_chat_file_upload_too_large(client, auth_headers):
    file_content = b"0" * (MAX_FILE_SIZE + 10)
    files = {"file": ("large_attach.bin", file_content, "application/octet-stream")}
    response = client.post("/api/chat/upload", headers=auth_headers, files=files)
    assert response.status_code == 413

def test_chat_file_upload_magic_bytes_invalid(client, auth_headers):
    # This buffer should fail magic bytes AND fail UTF-8 decoding
    # 0xff 0xfe etc are invalid utf-8 sequences
    file_content = b"\xff\xfe\xfd\xfc\xfb\xfa\xf9\xf8\xf7\xf6\xf5\xf4\xf3\xf2"
    files = {"file": ("fake.bin", file_content, "application/octet-stream")}
    response = client.post("/api/chat/upload", headers=auth_headers, files=files)
    assert response.status_code == 415

def test_chat_file_upload_dangerous_extension(client, auth_headers):
    file_content = b"print('Hello world!')\n" + b"A"*100
    files = {"file": ("script.py", file_content, "text/x-python")}
    response = client.post("/api/chat/upload", headers=auth_headers, files=files)
    assert response.status_code == 403

def test_chat_audio_upload_success(client, auth_headers):
    file_content = b'\x1a\x45\xdf\xa3' + b"random_data_for_webm_file_so_it_is_long_enough"
    files = {"file": ("voice.webm", file_content, "audio/webm")}
    response = client.post("/api/chat/upload_audio", headers=auth_headers, files=files)
    assert response.status_code == 200

def test_chat_audio_upload_too_large(client, auth_headers):
    file_content = b'\x1a\x45\xdf\xa3' + b"0" * (MAX_AUDIO_SIZE + 10)
    files = {"file": ("large_audio.webm", file_content, "audio/webm")}
    response = client.post("/api/chat/upload_audio", headers=auth_headers, files=files)
    assert response.status_code == 413

def test_chat_audio_upload_magic_bytes_spoofing(client, auth_headers):
    file_content = b"random string that is long enough but not audio magic bytes"
    files = {"file": ("voice.webm", file_content, "audio/webm")}
    response = client.post("/api/chat/upload_audio", headers=auth_headers, files=files)
    assert response.status_code == 415
