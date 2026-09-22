# LCL Operations Centre (labmanager)

Internal operations app for Lueur Cosmetics Lab (LCL) — company planner,
calendar, task tracking, production/delivery/purchasing workflow, and a
Director Attention queue for Dr. Efua.

Companion to the separate **LCL Inventory** app: read-only toward it
(pulls ingredient/production data from Inventory's own Apps Script
endpoints), never writes to it.

- `index.html` / `manifest.json` / `service-worker.js` — the frontend, a
  single-file offline-first PWA.
- `apps-script/` — source for this project's own Google Apps Script
  backend + Sheet. See `apps-script/SETUP.md` for deployment steps.