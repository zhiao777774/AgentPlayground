FROM python:3.12-slim

# Install system dependencies required by PyMuPDF and other C-extensions
RUN apt-get update && apt-get upgrade -y && apt-get install -y \
    build-essential \
    libffi-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY ./app ./app

# Create a directory for temporary PDF uploads
RUN mkdir -p /tmp/rag_uploads && chmod 777 /tmp/rag_uploads

EXPOSE 8000

# Run FastAPI server via Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
