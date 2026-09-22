# Deploying OC's backend

Apps Script has no git integration, so these two files are the source of
truth — copy their contents into the script editor by hand.

1. Create a **new** Google Sheet (not Inventory's — a brand new one for
   Operations Centre).
2. In that Sheet: **Extensions → Apps Script**.
3. Replace the default `Code.gs` with this folder's `Code.gs`, then add a
   second script file named `Sheets.gs` and paste in this folder's
   `Sheets.gs`.
4. **Deploy → New deployment → type "Web app"**. Execute as **Me**, access
   **Anyone with the link** (same access model Inventory uses).
5. Copy the deployment's web app URL.
6. In `operations-centre/index.html`, set `SCRIPT_URL` to that URL (near
   `STAFF_PIN` / `ADMIN_PIN` at the top of the `<script>` block).
7. Open the app once while online — the first request runs
   `ensureAllSheets()` and creates all nine tabs (Users, Tasks, Production,
   Deliveries, Purchases, Communications, DirectorAttention, Calendar,
   ActivityLog) with their header rows.
8. Change `STAFF_PIN` and `ADMIN_PIN` in `index.html` to whatever Dr. Efua
   wants staff/admin to use — the shipped values are placeholders, not
   real PINs, same as Inventory's own "fill in before deploying" SCRIPT_URL
   comment.

Redeploying after an edit to `Code.gs`/`Sheets.gs`: **Deploy → Manage
deployments → edit (pencil) → New version**. A brand new deployment
changes the URL; editing the existing one does not.
