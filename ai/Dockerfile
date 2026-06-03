# Stage 1: Build compilation stage
FROM python:3.11-slim AS builder

WORKDIR /build

# Install dependencies required to compile dlib and other native extensions
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    libopenblas-dev \
    liblapack-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Production runtime stage
FROM python:3.11-slim

WORKDIR /app

# Install runtime library dependencies for OpenCV (headless) and dlib
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libopenblas-dev \
    liblapack-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy built site-packages from builder
COPY --from=builder /root/.local /root/.local
COPY app.py ./

ENV PATH=/root/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1

CMD ["python", "app.py"]
