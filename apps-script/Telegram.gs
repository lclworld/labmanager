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

function notifyTelegram(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_BOT_TOKEN");
  var chatIds = (props.getProperty("TELEGRAM_CHAT_IDS") || "")
    .split(",").map(function (s) { return s.trim(); }).filter(String);
  if (!token || !chatIds.length) return;

  chatIds.forEach(function (chatId) {
    try {
      var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", disable_web_page_preview: true }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() !== 200) console.warn("Telegram " + chatId + ": " + res.getContentText());
    } catch (err) {
      console.warn("Telegram " + chatId + ": " + err.message);
    }
  });
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

// Fired by the trigger setupDailyDigestTrigger() installs. Summarizes every
// ActivityLog row from the last 24 hours — every record type, not just
// flags — grouped by what kind of record it was and what happened to it.
// A quiet day sends one short "nothing logged" line instead of staying
// silent, so silence never has to be read as "the digest broke."
function sendDailyDigest() {
  try {
    var since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    var recent = getAllRows("ActivityLog").filter(function (r) {
      return r.timestamp && new Date(r.timestamp) >= since;
    });
    if (!recent.length) {
      notifyTelegram("📋 <b>Daily Digest</b>\nNothing logged in OC in the last 24 hours.");
      return;
    }
    var byType = {};
    recent.forEach(function (r) {
      var t = r.recordType || "Other";
      byType[t] = byType[t] || { count: 0, actions: {} };
      byType[t].count++;
      var a = r.action || "Other";
      byType[t].actions[a] = (byType[t].actions[a] || 0) + 1;
    });
    var lines = ["📋 <b>Daily Digest</b> — " + recent.length + " item(s) logged in the last 24 hours", ""];
    Object.keys(byType).sort().forEach(function (t) {
      var info = byType[t];
      var breakdown = Object.keys(info.actions).map(function (a) {
        return info.actions[a] + " " + a.toLowerCase();
      }).join(", ");
      lines.push("• <b>" + escapeTelegram(t) + "</b>: " + info.count + " (" + escapeTelegram(breakdown) + ")");
    });
    lines.push("", '<a href="' + OC_APP_URL + '">Open Operations Centre</a>');
    notifyTelegram(lines.join("\n"));
  } catch (err) {
    console.warn("Daily digest failed: " + err.message);
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

// Step 2: sends a test message to every saved chat.
function telegramTest() {
  notifyTelegram("✅ <b>LCL Operations Centre</b>\nTelegram alerts are working. You'll get a message here whenever something is flagged.");
}

// Optional: sends today's real digest right now, without waiting for the
// trigger — useful to see what it looks like before scheduling it.
function telegramDigestTest() {
  sendDailyDigest();
}
