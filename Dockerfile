FROM python:3.12-slim
WORKDIR /app
COPY requirements-api.txt requirements-import.txt ./
RUN pip install --no-cache-dir -r requirements-import.txt && useradd --create-home appuser
COPY main.py dashboard_logic.py deviation_logic.py workflow.py import_workflow.py bill_explanations.py data_chat.py http_transport.py prepare_ledger.py load_initial_import.py ./
COPY static ./static
USER appuser
ENV PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
