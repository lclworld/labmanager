/**
 * LCL Operations Centre — Sheets.gs
 *
 * Owns ONE spreadsheet: this project's own new Google Sheet.
 * Never touches LCL Inventory's spreadsheet or script in any way.
 *
 * If this script is bound to the Sheet (created via Extensions > Apps
 * Script from inside the Sheet itself — the recommended setup), leave
 * SPREADSHEET_ID blank and getActiveSpreadsheet() finds it automatically.
 * If run as a standalone script instead, paste the target Sheet's ID here.
 */

var SPREADSHEET_ID = "";

function getSpreadsheet() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

// One tab per record type (Section 5 of the spec). Column order here is the
// column order on the sheet — never reorder without migrating existing rows.
var SCHEMA = {
  Users: ["User ID", "Name", "Tier", "Last active", "First seen"],
  Tasks: ["Task ID", "Title", "Description", "Category", "Status", "Priority", "Assigned to", "Created by", "Created date", "Due date", "Completed date", "Director attention flag", "Missing information", "Notes", "Related record", "Last updated", "Archived", "Archived date"],
  // New columns are always appended at the end, never inserted — this sheet
  // may already have real rows in it, and every read/write here is purely
  // positional (column N in SCHEMA = column N in the sheet). Inserting or
  // reordering would silently misalign every existing row.
  Production: ["Production ID", "Client", "Product", "Inventory reference", "Batch size", "Planned date", "Assigned staff", "Packaging readiness", "Label readiness", "Box readiness", "Batch sheet status", "SOP status", "Production status", "QC status", "Filling status", "Final status", "Blocker", "Director review status", "Notes", "Created by", "Created date", "Last updated", "Archived", "Archived date", "Packaging type", "Packaging size", "Quantity filled", "Unit weight", "Actual production date", "PIF status", "PIF link"],
  Deliveries: ["Delivery ID", "Direction", "Client or supplier", "Items", "Delivery date", "Expected time", "Contact", "Packaging status", "Label status", "Box status", "Client confirmation", "Payment status", "Cost", "Status", "Notes", "Created by", "Created date", "Last updated", "Archived", "Archived date", "Related production", "PIF emailed"],
  Purchases: ["Purchase ID", "Supplier", "Item", "Category", "Quantity", "Amount", "Ordered", "Paid", "Expected arrival", "Received", "Responsible person", "Status", "Notes", "Created by", "Created date", "Last updated", "Archived", "Archived date"],
  Communications: ["Communication ID", "Date", "Type", "Related record", "Sender", "Recipient", "Message", "Action required", "Status", "Follow-up date", "Created by", "Last updated", "Archived", "Archived date"],
  DirectorAttention: ["Attention ID", "Related record", "Category", "Issue", "What is needed from Director", "Missing information", "Flagged by", "Date flagged", "Priority", "Deadline", "Status", "Director response", "Date resolved", "Archived", "Archived date"],
  Calendar: ["Event ID", "Title", "Date", "Start time", "End time", "Event type", "Owner", "Related record", "Location", "Notes", "Status", "Created by", "Last updated", "Archived", "Archived date"],
  ActivityLog: ["Log ID", "Timestamp", "User", "Tier", "Record type", "Record ID", "Action", "Previous status", "New status", "Details"]
};

// The first column of every schema above is that sheet's ID column.
var ID_PREFIX = {
  Users: "USR", Tasks: "TASK", Production: "PROD", Deliveries: "DEL",
  Purchases: "PUR", Communications: "COM", DirectorAttention: "ATT",
  Calendar: "EVT", ActivityLog: "LOG"
};

function ensureSheet(name) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  var headers = SCHEMA[name];
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Only write headers into a sheet that's genuinely empty — never touch a
  // sheet that already has data, even if someone reordered its columns.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // SCHEMA can grow over time (new fields added to this file after a sheet
  // already has real rows in it). A sheet's own header row is never
  // rewritten retroactively, so without this, any column SCHEMA has that
  // the sheet doesn't would make updateRecord()/appendRow() silently no-op
  // on that field forever (they only ever write a column they can find by
  // header name) — the exact bug that lost every Post-Production/PIF edit
  // on existing Production rows. Bridge the gap by appending just the
  // missing headers at the end of row 1; this never touches an existing
  // column or any existing row's data.
  var existingLastCol = sheet.getLastColumn();
  if (existingLastCol < headers.length) {
    var missing = headers.slice(existingLastCol);
    sheet.getRange(1, existingLastCol + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function ensureAllSheets() {
  Object.keys(SCHEMA).forEach(ensureSheet);
}

// "Director attention flag" -> "directorAttentionFlag"
function headerToKey(header) {
  return header
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .map(function (word, i) {
      word = word.toLowerCase();
      return i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}

// Columns that hold a plain calendar date (from an HTML <input type="date">
// on the frontend, e.g. "2026-09-25") rather than a moment in time. Sheets
// auto-recognizes a string like that on write and silently stores the cell
// as a real Date — reading it back with .toISOString() then hands the
// frontend a full UTC timestamp ("2026-09-24T22:00:00.000Z") that never
// string-equals the plain date it originally wrote (and can even land on
// the wrong calendar day once the spreadsheet's timezone shifts it), which
// is exactly what broke every exact-match date comparison in Calendar and
// Planner. Formatting only these columns back to "yyyy-MM-dd", in the
// spreadsheet's own timezone, round-trips them exactly as written; every
// other Date cell (created/updated timestamps) keeps the original full
// ISO string.
var DATE_ONLY_KEYS = {
  dueDate: true, completedDate: true, date: true, deadline: true,
  followUpDate: true, plannedDate: true, actualProductionDate: true,
  deliveryDate: true, expectedArrival: true
};

function getAllRows(name) {
  var sheet = ensureSheet(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var keys = headers.map(headerToKey);
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var tz = getSpreadsheet().getSpreadsheetTimeZone();
  return values.map(function (row) {
    var obj = {};
    keys.forEach(function (key, i) {
      var v = row[i];
      if (v instanceof Date) {
        obj[key] = DATE_ONLY_KEYS[key] ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v.toISOString();
      } else {
        obj[key] = v;
      }
    });
    return obj;
  });
}

// Scans column A for "<PREFIX>-0001"-style IDs and returns the next one.
// Wrapped in a lock by the caller — never call this without holding one.
function nextId(name) {
  var prefix = ID_PREFIX[name];
  var sheet = ensureSheet(name);
  var lastRow = sheet.getLastRow();
  var max = 0;
  if (lastRow >= 2) {
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var pattern = new RegExp("^" + prefix + "-(\\d+)$");
    ids.forEach(function (r) {
      var m = String(r[0]).match(pattern);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    });
  }
  return prefix + "-" + ("0000" + (max + 1)).slice(-4);
}

function appendRow(name, rowObject) {
  var sheet = ensureSheet(name);
  var keys = SCHEMA[name].map(headerToKey);
  var row = keys.map(function (key) {
    return rowObject.hasOwnProperty(key) ? rowObject[key] : "";
  });
  sheet.appendRow(row);
}

// Generic create: locks, generates the next ID for this sheet, appends a
// row built from `fields` (keys matching headerToKey(SCHEMA[name][i])),
// and returns the new ID. Shared by every Phase 3+ "create___" handler.
function createRecord(name, fields) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var idKey = headerToKey(SCHEMA[name][0]);
    var id = nextId(name);
    var row = Object.assign({}, fields);
    row[idKey] = id;
    appendRow(name, row);
    return id;
  } finally {
    lock.releaseLock();
  }
}

// Generic read-one: finds the row whose ID column matches idValue.
function getRowById(name, idValue) {
  var rows = getAllRows(name);
  var idKey = headerToKey(SCHEMA[name][0]);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][idKey]) === String(idValue)) return rows[i];
  }
  return null;
}

// Generic patch-by-id: locks, finds the row by its ID column, and writes
// only the columns present in `fields`. Auto-stamps "Last updated" when
// the sheet has that column and the caller didn't already set it. Shared
// by every Phase 3+ "update___" handler — never silently drops a column
// that isn't in `fields`.
function updateRecord(name, idValue, fields) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = ensureSheet(name);
    var keys = SCHEMA[name].map(headerToKey);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return false;
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(idValue)) {
        var rowIndex = i + 2;
        var patch = Object.assign({}, fields);
        if (keys.indexOf("lastUpdated") >= 0 && !patch.hasOwnProperty("lastUpdated")) {
          patch.lastUpdated = new Date().toISOString();
        }
        Object.keys(patch).forEach(function (key) {
          var colIndex = keys.indexOf(key);
          if (colIndex >= 0) sheet.getRange(rowIndex, colIndex + 1).setValue(patch[key]);
        });
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

function logActivity(user, tier, recordType, recordId, action, previousStatus, newStatus, details) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    appendRow("ActivityLog", {
      logId: nextId("ActivityLog"),
      timestamp: new Date().toISOString(),
      user: user || "",
      tier: tier || "",
      recordType: recordType || "",
      recordId: recordId || "",
      action: action || "",
      previousStatus: previousStatus || "",
      newStatus: newStatus || "",
      details: details || ""
    });
  } finally {
    lock.releaseLock();
  }
}
