/**
 * LCL Operations Centre — Telegram.gs
 *
 * Two kinds of Telegram messages:
 *  - Instant: the moment something is flagged for Manager attention, so
 *    it reaches the phone even when the app is closed (sendFlagMessage).
 *  - Daily digest: everything logged to OC — every create/update across
 *    every record type, not just flags — summarized into one message a
 *    day instead of pinging on every single save (sendDailyDigest). Needs
 *    a one-time trigger; see setupDailyDigestTrigger below and SETUP.md.
 *
 * The bot token and chat IDs live in Script Properties (Project Settings →
 * Script Properties), never in this file:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather
 *   TELEGRAM_CHAT_IDS   — one or more chat IDs, comma-separated
 * See SETUP.md, "Telegram alerts".
 *
 * A failed or unconfigured alert never blocks the flag itself: the record
 * is already saved before notifyTelegram runs, and errors are only logged.
 */

var OC_APP_URL = "https://lclworld.github.io/labmanager/";

// Returns true if it actually tried to send (token + at least one chat ID
// configured), false if it bailed out before even attempting delivery —
// callers that run interactively (telegramTest, telegramDigestTest) check
// this so "nothing arrived" has a visible reason in the execution log
// instead of looking like a silent success.
function notifyTelegram(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_BOT_TOKEN");
  var chatIds = (props.getProperty("TELEGRAM_CHAT_IDS") || "")
    .split(",").map(function (s) { return s.trim(); }).filter(String);
  if (!token) { console.warn("Telegram: TELEGRAM_BOT_TOKEN is not set in Script Properties — nothing was sent."); return false; }
  if (!chatIds.length) { console.warn("Telegram: TELEGRAM_CHAT_IDS is not set in Script Properties — nothing was sent. Run telegramFindChatIds first."); return false; }

  var anyOk = false;
  chatIds.forEach(function (chatId) {
    try {
      var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() === 200) {
        anyOk = true;
      } else {
        console.warn("Telegram " + chatId + ": HTTP " + res.getResponseCode() + " — " + res.getContentText());
      }
    } catch (err) {
      console.warn("Telegram " + chatId + ": " + err.message);
    }
  });
  return anyOk;
}

function escapeTelegram(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function notifyFlagRaised(id, p) {
  try {
    sendFlagMessage(id, p);
  } catch (err) {
    console.warn("Telegram alert failed: " + err.message);
  }
}

function sendFlagMessage(id, p) {
  var urgent = p.priority === "Urgent" || p.priority === "High";
  var lines = [
    (urgent ? "🔴 <b>" + escapeTelegram(p.priority) + " flag</b>" : "⚑ <b>New flag</b>") + " · " + escapeTelegram(id),
    "",
    "<b>" + escapeTelegram(p.issue) + "</b>"
  ];
  if (p.whatIsNeededFromDirector) lines.push("Needed: " + escapeTelegram(p.whatIsNeededFromDirector));
  if (p.missingInformation) lines.push("Missing: " + escapeTelegram(p.missingInformation));
  if (p.category) lines.push("Category: " + escapeTelegram(p.category));
  if (p.deadline) lines.push("Deadline: " + escapeTelegram(String(p.deadline).slice(0, 10)));
  if (p.flaggedBy) lines.push("Flagged by: " + escapeTelegram(p.flaggedBy));
  lines.push("", '<a href="' + OC_APP_URL + '">Open Operations Centre</a>');
  notifyTelegram(lines.join("\n"));
}

// ---------- Daily digest ----------

// Clips only a line's free-text detail (an issue, a message) so one very
// long entry can't dominate the digest — never the whole line.
function clipDigestText_(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function daysAgoText_(iso) {
  var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return days + " days ago";
}
// One ActivityLog row -> one readable line: record type + what happened
// (with the status it moved to, when there is one) + the batch/task/item
// it was about + who did it. This is what makes the digest a narrative
// instead of a bare tally -- every line names the real thing that changed.
function formatDigestLine_(r) {
  var who = escapeTelegram(r.user || "Unknown") + (r.tier === "Manager" ? " (Manager)" : "");
  var head = escapeTelegram(r.recordType || "") + " " + escapeTelegram(r.action || "");
  var transition = "";
  if (r.newStatus && r.previousStatus && r.newStatus !== r.previousStatus) {
    transition = " (" + escapeTelegram(r.previousStatus) + " → " + escapeTelegram(r.newStatus) + ")";
  } else if (r.newStatus && !r.previousStatus) {
    transition = " (" + escapeTelegram(r.newStatus) + ")";
  }
  var detail = r.details ? ": " + escapeTelegram(clipDigestText_(r.details, 90)) : "";
  return "• " + head + transition + detail + " — " + who;
}
// Telegram refuses a message over 4096 characters. Packs the digest's
// lines into as few messages as fit, splitting only at line breaks (never
// mid-line), and sends them in order -- so "send everything" still works
// on a busy day instead of silently truncating or erroring out.
var TELEGRAM_CHUNK_LEN_ = 3500;
function sendTelegramChunks_(sections) {
  var allLines = [];
  sections.forEach(function (s, i) {
    if (i > 0) allLines.push("");
    s.split("\n").forEach(function (line) { allLines.push(line); });
  });
  var chunks = [];
  var current = "";
  allLines.forEach(function (line) {
    var candidate = current ? (current + "\n" + line) : line;
    if (candidate.length > TELEGRAM_CHUNK_LEN_ && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  });
  if (current) chunks.push(current);

  var allOk = true;
  chunks.forEach(function (chunk, i) {
    var text = chunks.length > 1 ? "(" + (i + 1) + "/" + chunks.length + ")\n" + chunk : chunk;
    if (!notifyTelegram(text)) allOk = false;
  });
  return allOk;
}

// Fired by the trigger setupDailyDigestTrigger() installs. Two parts:
//  1. Needs Your Attention -- every currently-open Manager Attention item,
//     a live status snapshot shown even on a quiet day (this already
//     covers every auto-paging case: BLOCKED, Waiting for Manager/
//     Purchase, QC Failed, unreviewed completions -- all of them flag
//     Manager Attention on their own, so this one list is the complete
//     "what still needs me" picture).
//  2. What Happened -- every single ActivityLog row from the last 24
//     hours, one line each, in full -- no cap, no "+N more". The Manager
//     asked for everything, since she's rarely around to see it live.
function sendDailyDigest() {
  try {
    var attention = (getAllRows("DirectorAttention") || []).filter(function (r) { return r.status === "Open"; });
    var since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    var recent = getAllRows("ActivityLog").filter(function (r) {
      return r.timestamp && new Date(r.timestamp) >= since;
    }).sort(function (a, b) { return String(a.timestamp).localeCompare(String(b.timestamp)); });

    var attLines = ["🔴 <b>Needs Your Attention</b> (" + attention.length + " open)"];
    if (!attention.length) {
      attLines.push("Nothing open right now.");
    } else {
      attention.forEach(function (a) {
        attLines.push("• " + escapeTelegram(clipDigestText_(a.issue || "(no issue text)", 100)) +
          " — " + escapeTelegram(a.flaggedBy || "Unknown") +
          (a.priority ? " · " + escapeTelegram(a.priority) : "") +
          (a.dateFlagged ? " · " + daysAgoText_(a.dateFlagged) : ""));
      });
    }

    var dayLines = ["📋 <b>What Happened</b> — " + recent.length + " item(s) in the last 24 hours"];
    if (!recent.length) {
      dayLines.push("Nothing logged.");
    } else {
      recent.forEach(function (r) { dayLines.push(formatDigestLine_(r)); });
    }

    var linkLine = '<a href="' + OC_APP_URL + '">Open Operations Centre</a>';
    return sendTelegramChunks_([attLines.join("\n"), dayLines.join("\n"), linkLine]);
  } catch (err) {
    console.warn("Daily digest failed: " + err.message);
    return false;
  }
}

// Run once from the script editor to schedule the digest (see SETUP.md,
// "Daily digest"). Safe to re-run — it clears any digest trigger this
// project already has first, so re-running to change the hour never
// leaves a duplicate behind.
function setupDailyDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendDailyDigest") ScriptApp.deleteTrigger(t);
  });
  // atHour + nearMinute is Apps Script's own way to request a specific
  // half-hour — triggers don't fire at the exact minute, but within about
  // 15 minutes of it, same as any other time-based trigger here.
  ScriptApp.newTrigger("sendDailyDigest").timeBased().everyDays(1).atHour(17).nearMinute(30).create();
  console.log("Daily digest scheduled for ~5:30pm daily (the project's own time zone — Project Settings → General → Time zone).");
}

// ---------- Setup helpers: run these from the script editor ----------

// Step 1: after messaging your bot from Telegram, run this. It logs the chat
// ID of everyone who has messaged the bot recently, and saves them all as
// TELEGRAM_CHAT_IDS if that isn't set yet.
function telegramFindChatIds() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Add TELEGRAM_BOT_TOKEN in Project Settings → Script Properties first.");
  var res = JSON.parse(UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/getUpdates").getContentText());
  var chats = {};
  (res.result || []).forEach(function (u) {
    var m = u.message || u.my_chat_member || u.channel_post;
    if (m && m.chat) chats[m.chat.id] = m.chat.title || [m.chat.first_name, m.chat.last_name].filter(String).join(" ");
  });
  var ids = Object.keys(chats);
  if (!ids.length) { console.log("No messages found. Send your bot a message (e.g. \"hi\") in Telegram, then run this again."); return; }
  ids.forEach(function (id) { console.log(id + "  " + chats[id]); });
  if (!props.getProperty("TELEGRAM_CHAT_IDS")) {
    props.setProperty("TELEGRAM_CHAT_IDS", ids.join(","));
    console.log("Saved TELEGRAM_CHAT_IDS = " + ids.join(","));
  }
}

// Step 2: sends a test message to every saved chat. Logs a clear pass/fail
// instead of just running green with nothing to show for it.
function telegramTest() {
  var ok = notifyTelegram("✅ <b>LCL Operations Centre</b>\nTelegram alerts are working. You'll get a message here whenever something is flagged.");
  console.log(ok ? "Sent — check Telegram now." : "Did NOT send — see the warning above this line for why (run View → Logs if you don't see one).");
}

// Optional: sends today's real digest right now, without waiting for the
// trigger — useful to see what it looks like before scheduling it. Also
// reports pass/fail, same as telegramTest.
function telegramDigestTest() {
  var ok = sendDailyDigest();
  console.log(ok ? "Sent — check Telegram now." : "Did NOT send — see the warning above this line for why (run View → Logs if you don't see one).");
}
