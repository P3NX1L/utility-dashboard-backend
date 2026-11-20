# First Western Tenant Notices

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Render static hosting

Create a **Static Site**, not a web service. The included `render.yaml` declares these exact settings:

- Root directory: repository root (leave blank).
- Build command: `bun install --frozen-lockfile && bun run build:render`.
- Publish directory: `dist/client`.
- Start command: none.
- Environment: `VITE_SUPABASE_URL=https://uowhdiufxssggeihiece.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY` set to the existing project's publishable key.
- Rewrites: `/five-day` → `/five-day/index.html`; `/access` → `/access/index.html`; `/five-day/exports` → `/five-day/exports/index.html`; `/access/exports` → `/access/exports/index.html`; final SPA fallback `/*` → `/index.html` (existing files take priority).

### Text-only source export

`deployment-assets.json` at the repository root contains exact base64 encodings of the original `public/favicon.png` and `src/assets/five-day-heading.png`. Include this JSON and the `scripts/` folder when exporting source through a text-only file API. `build:render` restores those two PNGs before running the normal production build, then copies `dist/client/index.html` to `dist/client/404.html`. The fallback index hydrates the existing router, so unknown URLs show the existing 404 view and known routes keep their layouts and staff authentication. Asset restoration uses a fixed two-path allowlist and does not alter the PNG bytes. No GitHub API upload or deployment is performed by the build entry itself.

The build prerenders `/`, `/five-day`, `/access`, `/five-day/exports`, and `/access/exports`; only visitor-identical sign-in shells are captured, never a staff session or uploaded tenant data. Deploy only `dist/client`, not the generated server bundle. Environment variables are compiled into the browser app, so rebuild after changing either value. Never use a service-role key.

Existing office staff sign in using their existing email/password accounts. This app has no signup and does not create accounts, tables, or infrastructure. Keep public signup disabled in the existing authentication project's settings; that hosted setting cannot be established from source alone. Tenant CSV parsing, editing, PDF previews, and ZIP creation all run in browser memory. Only authentication requests reach the shared project. Completed exports are saved locally in IndexedDB under the signed-in account ID only after every actual-byte PDF preview has rendered and staff click Download. One tenant downloads an `application/pdf` `.pdf`; multiple tenants download an `application/zip` with individual PDFs. Access output remains explicitly DRAFT. Histories are separate by account and notice type, survive refresh on the same browser/origin, and are hidden immediately on sign-out or account change. This is browser-local account scoping, not protection against someone with browser-profile/developer-tool access; use separate OS/browser profiles on shared computers. Clearing site data removes histories; exports do not sync across devices.

### Verification and remaining setup

The publishable key is not currently supplied to this checkout; shared-project sign-in remains unverified. Set the two environment values in Lovable's external connection settings and in Render before deploying. No GitHub repository URL is exposed by this checkout's remotes, so GitHub connection/status is unverified; check **Project settings → Git** for the connected repository. No app has been published by this change.

Verified: 22 automated tests; browser CSV selection, independent property signatures, required owners, three actual-byte PDF previews, three unique ZIP entries, edit invalidation, mobile layout, and preserved access navigation. Independent inspection of the downloaded PDFs confirms one 612×792 page each, Times Roman/Bold at 12 points, correct property owners/signers, rent-only amounts, and text inside page boundaries. The preview reports build OK, but it does not expose emitted static files; an actual Render build/deployment and hosted authentication settings remain unverified.
