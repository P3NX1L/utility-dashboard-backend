<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- Tenant Notices is client-only (no server functions); uploaded data stays in browser memory, so it can be hosted as a static site.
- Supabase is an existing external project read only from VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY; never provision or migrate it from this repo.
- Production builds must require a Supabase staff session; the no-auth demo mode is dev-only (src/lib/supabase.ts).
- Notice layouts live in src/lib/notices/templates.ts as field-keyed block mappings; keep `isDraft` true until real office templates replace the blocks.
- The app must never send email/SMS or call AppFolio; it only produces copyable text and printable PDFs.
- The active 5-day route uses an isolated grouped-report model and office PDF renderer; legacy draft workspaces remain dormant so access notices and preserved files do not change.
- Keep office text coordinates in templates.ts and the supplied raster heading as a bundled local asset; pdf-lib uses Times at 12 points and measured overflow moves later baselines rather than clipping legal text.
- ZIP generation is atomic and tied to an in-memory edit revision; discard in-flight or completed output after edits and require every byte-rendered PDF preview before download to prevent stale or incomplete handoff.
- Keep owner and signer on each imported property group and derive selected PDF inputs from that group so edits never leak across properties.
- Prerender only the three public, visitor-identical page shells to dist/client with Nitro disabled; Render serves those files while staff auth and uploaded tenant processing run exclusively in the browser.
- The Render build restores only the two allowlisted PNGs from deployment-assets.json before the production build and copies the generated index to 404.html afterward; text-only exports preserve exact media bytes and the existing client router handles fallback URLs.
