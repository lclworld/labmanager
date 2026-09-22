/**
 * LCL Operations Centre — Code.gs
 *
 * This project's own Apps Script Web App: its own deployment, its own
 * Sheet. It never opens, edits, or calls into LCL Inventory's script or
 * spreadsheet. The only relationship to Inventory is a read-only HTTPS
 * call OC's frontend makes directly to Inventory's own deployment
 * (?action=getIngredients / ?action=getProductionData) — nothing here.
 *
 * Request pattern (mirrors Inventory's own):
 *   GET  {deployment url}?action=X   -> read, returns JSON
 *   POST {deployment url}?action=X   -> write, JSON body sent as text/plain
 *                                       (avoids a CORS preflight, same as Inventory)
 * Every response is JSON: {status:"ok", ...} or {status:"error", message:"..."}.
 *
 * Phase 2 scope: health check, dashboard bootstrap counts, and the Users
 * log (who has opened the app). Task/Production/Delivery/Purchase/etc.
 * read+write actions are added in Phase 3/4 — this file's job right now is
 * to prove the connection works and all nine tabs exist.
 */

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function errorOut(message) {
  return jsonOut({ status: "error", message: String(message) });
}

function doGet(e) {
  try {
    ensureAllSheets();
    var action = e.parameter.action;
    switch (action) {
      case "ping":
        return jsonOut({ status: "ok", message: "LCL Operations Centre backend is running", serverTime: new Date().toISOString() });
      case "getBootstrap":
        return jsonOut(handleGetBootstrap());
      case "getUsers":
        return jsonOut({ status: "ok", users: getAllRows("Users") });
      default:
        return errorOut("Unknown action: " + action);
    }
  } catch (err) {
    return errorOut(err.message);
  }
}

function doPost(e) {
  try {
    ensureAllSheets();
    var action = e.parameter.action;
    var payload = {};
    try { payload = JSON.parse(e.postData.contents); } catch (parseErr) { payload = {}; }
    switch (action) {
      case "logUser":
        return jsonOut(handleLogUser(payload));
      default:
        return errorOut("Unknown action: " + action);
    }
  } catch (err) {
    return errorOut(err.message);
  }
}

function handleGetBootstrap() {
  var counts = {};
  Object.keys(SCHEMA).forEach(function (name) {
    counts[name] = getAllRows(name).length;
  });
  return { status: "ok", counts: counts, serverTime: new Date().toISOString() };
}

// Users is a log of who has used the app (Section 5), not a login table —
// the PIN gates access, this just records attribution + last-seen.
function handleLogUser(payload) {
  var name = (payload.name || "").trim();
  var tier = payload.tier || "Employee";
  if (!name) return { status: "error", message: "Name is required" };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = ensureSheet("Users");
    var lastRow = sheet.getLastRow();
    var now = new Date().toISOString();
    if (lastRow >= 2) {
      var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); // User ID, Name, Tier
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][1]).toLowerCase() === name.toLowerCase() && values[i][2] === tier) {
          sheet.getRange(i + 2, 4).setValue(now); // Last active
          return { status: "ok", userId: values[i][0] };
        }
      }
    }
    var userId = nextId("Users");
    sheet.appendRow([userId, name, tier, now, now]);
    return { status: "ok", userId: userId };
  } finally {
    lock.releaseLock();
  }
}
