# Deploying OC's backend

Apps Script has no git integration, so these two files are the source of
truth — copy their contents into the script editor by hand.

1. Create a **new** Google Sheet (not Inventory's — a brand new one for
   Operations Centre).
2. In that Sheet: **Extensions → Apps Script**.
3. Replace the default `Code.gs` with this folder's `Code.gs`, then add
   script files named `Sheets.gs` and `Telegram.gs` and paste in this
   folder's copies.
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

Redeploying after an edit to any `.gs` file: **Deploy → Manage
deployments → edit (pencil) → New version**. A brand new deployment
changes the URL; editing the existing one does not.

## Telegram alerts

Every flag for Manager attention also sends a Telegram message, so it
reaches the phone even when the app is closed. Until the two Script
Properties below are set, nothing is sent and flags work as before.

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name (e.g.
   "LCL Alerts") and a username ending in `bot`. Copy the token it gives
   you. Treat it like a password.
2. Open your new bot in Telegram and send it any message (e.g. "hi").
   Everyone who should get alerts does this from their own Telegram.
3. In the Apps Script editor, make sure `Telegram.gs` is there (see step 3
   above) and that `Code.gs` is the latest copy from this folder.
4. **Project Settings (gear) → Script Properties → Add script property**:
   `TELEGRAM_BOT_TOKEN` = the token from step 1. Save.
5. Back in the editor, open `Telegram.gs`, choose `telegramFindChatIds`
   in the function menu, and click **Run**. Approve the permission prompt
   (it needs "connect to an external service" to reach Telegram). The log
   lists everyone who messaged the bot and saves them as
   `TELEGRAM_CHAT_IDS`.
6. Choose `telegramTest` and click **Run**. Your phone should buzz.
7. **Deploy → Manage deployments → edit (pencil) → New version** so the
   live app uses the new code.

To add someone later: they message the bot, you run `telegramFindChatIds`
to see their ID, then add it to `TELEGRAM_CHAT_IDS` (comma-separated).
