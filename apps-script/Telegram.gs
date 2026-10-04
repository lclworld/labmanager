/**
 * LCL Operations Centre — Telegram.gs
 *
 * Sends a Telegram message when something is flagged for Manager
 * attention, so it reaches the phone even when the app is closed.
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
