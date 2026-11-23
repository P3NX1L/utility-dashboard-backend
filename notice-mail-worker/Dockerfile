FROM mcr.microsoft.com/playwright/python:v1.56.0-noble
WORKDIR /app
RUN pip install --no-cache-dir playwright==1.56.0 fastapi==0.116.1 uvicorn==0.35.0 httpx==0.28.1 cryptography==46.0.3
COPY appfolio.py server.py check.py ./
RUN python check.py
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-10000} --no-access-log"]
