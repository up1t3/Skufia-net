import os
import aioboto3

class S3AsyncClient:
    def __init__(self):
        # Configure using environment variables
        self.endpoint_url = os.getenv('AWS_S3_ENDPOINT_URL')
        self.region_name = os.getenv('AWS_REGION')
        self.aws_access_key_id = os.getenv('AWS_ACCESS_KEY_ID')
        self.aws_secret_access_key = os.getenv('AWS_SECRET_ACCESS_KEY')
        self.bucket_name = os.getenv('AWS_S3_BUCKET_NAME')
        self.session = aioboto3.Session()

    def _get_client_kwargs(self):
        kwargs = {}
        if self.endpoint_url:
            kwargs['endpoint_url'] = self.endpoint_url
        if self.region_name:
            kwargs['region_name'] = self.region_name
        if self.aws_access_key_id:
            kwargs['aws_access_key_id'] = self.aws_access_key_id
        if self.aws_secret_access_key:
            kwargs['aws_secret_access_key'] = self.aws_secret_access_key
        return kwargs

    async def generate_presigned_upload_url(self, object_name: str, expiration: int = 3600) -> str:
        """
        Generate a presigned PUT URL for client-side uploads.
        """
        async with self.session.client('s3', **self._get_client_kwargs()) as s3_client:
            response = await s3_client.generate_presigned_url(
                'put_object',
                Params={'Bucket': self.bucket_name, 'Key': object_name},
                ExpiresIn=expiration
            )
            return response

    async def generate_presigned_download_url(self, object_name: str, expiration: int = 3600) -> str:
        """
        Generate a presigned GET URL for reading objects.
        """
        async with self.session.client('s3', **self._get_client_kwargs()) as s3_client:
            response = await s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self.bucket_name, 'Key': object_name},
                ExpiresIn=expiration
            )
            return response

    async def read_object(self, object_name: str) -> bytes:
        """
        Asynchronously read an object's contents from S3 into memory as bytes.
        """
        async with self.session.client('s3', **self._get_client_kwargs()) as s3_client:
            response = await s3_client.get_object(Bucket=self.bucket_name, Key=object_name)
            async with response['Body'] as stream:
                return await stream.read()

# We can optionally instantiate a singleton instance
s3_client = S3AsyncClient()
