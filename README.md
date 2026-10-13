# Utility Dashboard Backend

Authenticated FastAPI service for a single-company utility portfolio, backed by Supabase.
The application serves portfolio totals, property charts, saved analysis, and revision-protected investigation notes/status history.

## Deployment

Deploy the included Dockerfile on Render. It starts Uvicorn on 0.0.0.0:$PORT.
Set SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY and exact frontend ALLOWED_ORIGINS as runtime environment variables.
Credentials and bill records are not included in this repository.
The browser uses the publishable key for Auth; server credentials stay on the backend.

## Development

Use Python 3.12. Install requirements-api.txt and copy .env.example to .env with your own configuration.
Run: python -m uvicorn main:app --reload
Tests: python -m pytest -q
Health check: /health
API schema: /openapi.json

The included render.yaml starts on the free plan. An always-on plan is appropriate for production use.
The financial rules are historical spending comparisons; uncertain dates/history remain reviewable.
