# 5-day notices
- [x] Parse grouped AppFolio UTF-8 CSV without tenant loss; rent-only selection.
- [x] Review and edit tenant details and batch property owners on existing route.
- [x] Reproduce office PDF; byte-based preview and atomic, unique-file ZIP.
- [x] Test parser, demand rules, document geometry, ZIP invalidation and browser flow; stay unpublished.

Verification uses synthetic uploads only; the real CSV was not attached. Existing external staff sign-in cannot be checked without an available staff session.

# Property signing and static hosting
- [x] Scope editable signers and required legal owners to each selected property.
- [x] Keep existing staff-only sign-in through the two external project environment variables, with no signup or infrastructure changes.
- [x] Verify synthetic report export, property signatures, actual-byte previews, unique ZIP contents, and desktop/mobile rendering; 22 tests pass.
- [x] Configure static prerender output and document exact Render settings and repository availability; preview build reports OK.
- [ ] Verify emitted static pages on Render (blocked: the preview build exposes no static output folder, and no Render deployment is available).
- [ ] Verify shared staff sign-in (blocked: publishable key and an existing staff session are unavailable).

# Text-only source export
- [x] Encode the two original PNGs at repo root and verify byte equality.
- [x] Add and test Render build asset restoration and index/404 fallback; document settings and commit (24 tests passed).
