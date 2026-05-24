# Use a lightweight Python image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies if needed (e.g., for some python libs and ffmpeg for video transcoding)
# We limit to ffmpeg and no-install-recommends to speed up download, and avoid heavy dev packages unless needed.
# Let's clean up apt cache as fast as possible to prevent using disk/RAM space.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend code
COPY . .

# Expose FastAPI port
EXPOSE 8007

# Run the application using Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8007"]