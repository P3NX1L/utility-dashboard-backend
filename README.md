# Utility Dashboard API

This patch reuses TLS certificate configuration across isolated per-request clients and reads only public import metadata for preview/history/repeated uploads. Staged ledger payloads remain server-only and are loaded only for matching or activation, reducing memory pressure on the existing service. Upload, matching and activation behavior is unchanged.

The existing Supabase database and authentication are the source of truth. Lovable supplies the frontend; Render hosts this Python API. This release adds a focused read-only utility-data question endpoint while retaining short bill explanations.

## Ask your data

`POST /api/v1/chat` accepts `import_id`, `question` (1–1200 characters), `property_ids` (null for all, otherwise a nonempty UUID list), `category`, `start_date`, `end_date`, and optional `bill_id`. Approved admins, reviewers and viewers can ask questions; the endpoint never writes records or changes review statuses. Unknown buildings, stale imports, invalid ranges and empty selections are rejected before AI is called.

The existing server-only `OPENAI_API_KEY` and `OPENAI_MODEL` interpret questions into a strict, validated intent and period. AI receives the question, selected building names/IDs and filter dates; it does not receive the ledger, accounts, descriptions, investigation notes or numeric expense results. Responses use `store:false`. Only predefined Python functions calculate totals, building comparisons, due-month trends, period increases, saved unresolved review priorities, potential duplicates and specific bill explanations. There is no generated SQL or arbitrary tool execution. User-selected building scope cannot be expanded by the model. Each response includes its effective scope, source filename, exact cents, typed table columns and record IDs for supporting frontend links. Questions needing unsupported physical usage, forecasts, diagnosis or writes receive clarification rather than invented facts.

Rate limits per backend instance: one active request per user, at most three active requests globally, ten questions per user per minute and sixty per hour. One upstream call, bounded timeout and output; no automatic AI retry. The frontend keeps conversations in memory only and discards old-import or cancelled responses. This first version treats each question independently; follow-up context is not inferred. Missing records remain unavailable rather than zero; limited history alone is not a review concern.

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

POST /api/v1/bills/{bill_id}/explanation accepts import_id and bill_version_id. The authenticated endpoint checks both against the active snapshot. Simple cases return factual templates without calling AI. For complex cases, AI selects up to two approved computed clauses, rather than authoring unverified facts. Only those clauses reach OpenAI; no property names, addresses, accounts, descriptions, notes, files or credentials are included. Responses use store:false. The server-only bill_explanation_cache persists results by import, bill version, analysis evidence, model and prompt version. Unique claims prevent duplicate simultaneous generation. Failed generation uses the factual template and does not repeatedly spend credits for the same evidence. Stale pending claims can recover after two minutes. New evidence produces a new cache key. The former /api/v1/insights endpoint is removed.

Apply migrations/005_bill_explanation_cache.sql once on a new database. It is already installed on the existing project. RLS is enabled; anon/authenticated have no table privileges. All reads and writes go through the approved-member FastAPI endpoint using the server-only Supabase key.

Source usage numbers are extracted without inventing physical units. usage_unit remains null until verified. Transaction-row sums are authoritative expense figures.

GET /api/v1/properties/{property_id}/monthly supplies monthly recorded building expense and an aligned breakdown for each account. Parameters: category, start_date, end_date and charge_scope (regular, other, all). Regular includes service_candidate transactions; Other separates installments, penalties, credits and remaining charges; All retains the complete signed ledger. Totals and breakdowns are computed in integer cents on the backend. Missing-month values are null, not assumed zero. Dates are bill due dates, without service-period allocation. Account coverage describes observed records and never asserts an expected invoice schedule. The account-level analysis and review endpoints remain the source of individual bill flags; monthly totals do not create a new baseline or hide offsetting account-level alerts.

GET /api/v1/review-queue supports repeated property_ids as well as legacy property_id. Filtering happens before counts and pagination. All business endpoints verify a Supabase token and current approved membership. Full schemas are in openapi.json and the hosted /docs endpoint.

## Code walkthrough

- prepare_ledger.py: normalize exported rows, exact cents, date/classification evidence, duplicate groups and reconciliation.
- import_workflow.py: validate workbook, match stable bills, stage previews and request atomic activation.
- import_schema.sql: membership-checked transaction boundaries, revision-safe matching and unchanged-review carry-forward.
- dashboard_logic.py: exact totals, building/account monthly expense, year comparisons and source-traceable ledger details.
- deviation_logic.py: explainable historical baselines and shared chart/flag evidence.
- workflow.py: saved analysis, review queue, revision-safe review updates.
- bill_explanations.py: short factual templates, constrained AI clause selection and persistent cache.
- main.py: authenticated API, explicit CORS and request limits. Snapshot caching never bypasses authorization.
- Lovable frontend: typed DataSource adapter, shared filters, review drawer, in-memory drafts and upload screens.

## Verification and limitations

Run `python -m pytest tests -q`. Tests cover cache reuse, changed evidence, concurrent generation claims, failed-AI fallback, schema validation, stale-version rejection and authentication, alongside the existing import/review/monthly tests. Building monthly and account totals reconcile against all 68 original properties across all three charge scopes. Transaction-only database checks covered preview isolation, activation + analysis, unchanged review carry-forward, changed-review staleness, uncertain match resolution and stale revision rejection. Tests rolled back; no test records remain.

The v0.6.0 backend is deployed and verified. This v0.7.0 question endpoint requires repository upload and Render deployment before live acceptance. Mobile and concurrent browser acceptance remain pending.

Possible extensions: verified physical units/consumption, provider rate comparisons, seasonal/weather context, assignment, richer source corrections and additional export formats. These require explicit supporting data and tests.
