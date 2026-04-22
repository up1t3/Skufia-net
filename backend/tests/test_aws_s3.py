import pytest
import os
import sys

# Ensure backend module can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from aws_s3 import S3AsyncClient
from unittest.mock import patch, MagicMock, AsyncMock

@pytest.mark.asyncio
async def test_generate_presigned_upload_url():
    with patch("aws_s3.aioboto3.Session") as mock_session:
        mock_client = AsyncMock()
        mock_client.generate_presigned_url.return_value = "http://fake-url.com/upload"

        mock_client_cm = MagicMock()
        mock_client_cm.__aenter__.return_value = mock_client
        mock_session.return_value.client.return_value = mock_client_cm

        s3 = S3AsyncClient()
        s3.bucket_name = "test-bucket"

        url = await s3.generate_presigned_upload_url("test.txt")
        assert url == "http://fake-url.com/upload"
        mock_client.generate_presigned_url.assert_called_with(
            'put_object',
            Params={'Bucket': 'test-bucket', 'Key': 'test.txt'},
            ExpiresIn=3600
        )

@pytest.mark.asyncio
async def test_generate_presigned_download_url():
    with patch("aws_s3.aioboto3.Session") as mock_session:
        mock_client = AsyncMock()
        mock_client.generate_presigned_url.return_value = "http://fake-url.com/download"

        mock_client_cm = MagicMock()
        mock_client_cm.__aenter__.return_value = mock_client
        mock_session.return_value.client.return_value = mock_client_cm

        s3 = S3AsyncClient()
        s3.bucket_name = "test-bucket"

        url = await s3.generate_presigned_download_url("test.txt")
        assert url == "http://fake-url.com/download"
        mock_client.generate_presigned_url.assert_called_with(
            'get_object',
            Params={'Bucket': 'test-bucket', 'Key': 'test.txt'},
            ExpiresIn=3600
        )

@pytest.mark.asyncio
async def test_read_object():
    with patch("aws_s3.aioboto3.Session") as mock_session:
        mock_client = AsyncMock()

        mock_stream = AsyncMock()
        mock_stream.read.return_value = b"fake data"
        mock_body_cm = MagicMock()
        mock_body_cm.__aenter__.return_value = mock_stream

        mock_client.get_object.return_value = {'Body': mock_body_cm}

        mock_client_cm = MagicMock()
        mock_client_cm.__aenter__.return_value = mock_client
        mock_session.return_value.client.return_value = mock_client_cm

        s3 = S3AsyncClient()
        s3.bucket_name = "test-bucket"

        data = await s3.read_object("test.txt")
        assert data == b"fake data"
        mock_client.get_object.assert_called_with(Bucket="test-bucket", Key="test.txt")
