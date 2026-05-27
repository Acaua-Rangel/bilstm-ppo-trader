FROM python:3.12-slim

# Install system dependencies (build-essential etc, if needed by pip packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install poetry
RUN pip install poetry

# Set working directory
WORKDIR /app

# Copy poetry config
COPY pyproject.toml poetry.lock ./

# Install dependencies (without virtualenv to system)
RUN poetry config virtualenvs.create false && poetry install --no-root

# Copy project files and models
COPY . .

# Run the trader bot
CMD ["python", "main.py"]
