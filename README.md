# Utility Dashboard API — v0.5.0

The existing Supabase database and authentication are the source of truth. Lovable supplies the frontend; Render hosts this Python API. This release adds validated Excel imports and evidence-based AI integration to the existing expense analytics and investigation workflow.

## Run / deploy

Python 3.12. Install `requirements-import.txt` (includes API requirements), then run `uvicorn main:app --host 0.0.0.0 --port $PORT`. The Dockerfile does this automatically. Use `/health` for process liveness. Keep server secrets out of the repository and frontend.

Required environment: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY, ALLOWED_ORIGINS (exact Lovable origins). The initial import records its private Storage bucket in imports.scope. New source files reuse that bucket.

Actual AI additionally requires OPENAI_API_KEY and OPENAI_MODEL on Render. Select a Responses API model supporting structured JSON output. If these are absent, AI endpoints return an honest unavailable state; calculated analysis still works. No API key is bundled.

The backend-only RPC definitions are in import_schema.sql. They have been installed and tested on the existing project. They use security-invoker execution, check current membership, and are executable only by service_role. Do not grant browser table access. extract_source_readings.sql documents the verified derived-field backfill.

## User roles

Viewer reads analytics, investigations, import history and original source downloads. Reviewer additionally saves reviews, uploads exports and resolves uncertain matches. Admin additionally activates imports and explicitly refreshes saved analysis. Colleagues require a Supabase Auth account and active app_members entry. There is no public signup.

## Upload workflow

1. POST /api/v1/imports/preview with JSON filename and content_base64. Only .xlsx full exports up to 5 MB; formulas must be exported as values. Invalid/rejected rows never become an active snapshot. Original file remains in private Storage.
2. Review transaction/property counts, totals, source-control differences and new/unchanged/updated/uncertain matches. Same file SHA is idempotent. All duplicate occurrences are retained.
3. Resolve uncertain matches with PATCH /api/v1/imports/{id}/matches and expected_revision. A candidate bill can be allocated once. Choosing bill_id:null explicitly creates a new transaction.
4. Admin activates with POST /api/v1/imports/{id}/activate. Warning-bearing full snapshots require acknowledgement; unresolved matches block activation. The database verifies totals, switches the active snapshot, carries genuinely unchanged reviews forward and saves analysis in one transaction. Any failure rolls back the entire activation. Changed bills retain history but appear stale/open for review.
5. Frontend invalidates dataset, properties, totals, charts, queues, investigations and AI queries. Previous snapshots remain stored. Archived snapshots are not currently reactivatable through the API.

GET /api/v1/imports lists history; GET /api/v1/imports/{id} reads a preview; GET /api/v1/imports/{id}/source creates a 60-second authenticated original-file download link.

## Analytics / AI

All deviations remain reviewable, including decreases and small changes. Significant changes are a separate focus view, not a deletion rule. Baselines use earlier eligible, nonoverlapping same-account/category/reading periods and never future records. Costs and expected values are computed in Python; AI only explains evidence and suggests checks. Inferred dates are provisional. Spending changes do not establish leaks or incorrect billing.

GET /api/v1/insights uses the same property/category/date scope as the overview. AI receives computed metrics and opaque evidence references, excluding property names, addresses, accounts, raw descriptions, notes and credentials. Outputs are structured and references validated. Responses use store:false; results are cached by import/model/filter scope. Human review is required.

Source usage numbers are extracted without inventing physical units. usage_unit remains null until verified. Source reconciliation preserves actual transaction sums and exposes inconsistent export control totals; no fabricated balancing entry is created.

GET /api/v1/review-queue supports repeated property_ids as well as legacy property_id. Filtering happens before counts and pagination. All business endpoints verify a Supabase token and current approved membership. Full schemas are in openapi.json and the hosted /docs endpoint.

## Code walkthrough

- prepare_ledger.py: normalize exported rows, exact cents, date/classification evidence, duplicate groups and reconciliation.
- import_workflow.py: validate workbook, match stable bills, stage previews and request atomic activation.
- import_schema.sql: membership-checked transaction boundaries, revision-safe matching and unchanged-review carry-forward.
- dashboard_logic.py: exact totals, monthly and year comparisons, source-traceable ledger details.
- deviation_logic.py: explainable historical baselines and shared chart/flag evidence.
- workflow.py: saved analysis, review queue, revision-safe review updates.
- insights.py: constrained AI explanations over computed evidence.
- main.py: authenticated API, explicit CORS and request limits. Snapshot caching never bypasses authorization.
- Lovable frontend: typed DataSource adapter, shared filters, review drawer, in-memory drafts and upload/insight screens.

## Verification and limitations

Run `python -m pytest tests -q`: 42 tests passed during development. Transaction-only database checks covered preview isolation, activation + analysis, unchanged review carry-forward, changed-review staleness, uncertain match resolution and stale revision rejection. Tests rolled back; no test records remain.

Live v0.5.0 deployment and real AI response validation must be completed after repository upload and server key configuration. Mobile and concurrent browser acceptance are still required. Do not describe these as passed before they are checked.

Possible extensions: verified physical units/consumption, provider rate comparisons, seasonal/weather context, assignment, richer source corrections and additional export formats. These require explicit supporting data and tests.
