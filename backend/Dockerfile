# Playwright's official Python image ships the system deps the browsers need.
FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m playwright install chromium

COPY app ./app

ENV PORT=8000
EXPOSE 8000
# ANTHROPIC_API_KEY is provided at runtime (docker run -e / Vultr env var).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
