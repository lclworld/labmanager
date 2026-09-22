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
  Tasks: ["Task ID", "Title", "Description", "Category", "Status", "Priority", "Assigned to", "Created by", "Created date", "Due date", "Completed date", "Director attention flag", "Missing information", "Notes", "Related record", "Last updated"],
  Production: ["Production ID", "Client", "Product", "Inventory reference", "Batch size", "Planned date", "Assigned staff", "Packaging readiness", "Label readiness", "Box readiness", "Batch sheet status", "SOP status", "Production status", "QC status", "Filling status", "Final status", "Blocker", "Director review status", "Notes", "Created by", "Created date", "Last updated"],
  Deliveries: ["Delivery ID", "Direction", "Client or supplier", "Items", "Delivery date", "Expected time", "Contact", "Packaging status", "Label status", "Box status", "Client confirmation", "Payment status", "Cost", "Status", "Notes", "Created by", "Created date", "Last updated"],
  Purchases: ["Purchase ID", "Supplier", "Item", "Category", "Quantity", "Amount", "Ordered", "Paid", "Expected arrival", "Received", "Responsible person", "Status", "Notes", "Created by", "Created date", "Last updated"],
  Communications: ["Communication ID", "Date", "Type", "Related record", "Sender", "Recipient", "Message", "Action required", "Status", "Follow-up date", "Created by", "Last updated"],
  DirectorAttention: ["Attention ID", "Related record", "Category", "Issue", "What is needed from Director", "Missing information", "Flagged by", "Date flagged", "Priority", "Status", "Director response", "Date resolved"],
  Calendar: ["Event ID", "Title", "Date", "Start time", "End time", "Event type", "Owner", "Related record", "Location", "Notes", "Status", "Created by", "Last updated"],
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

function getAllRows(name) {
  var sheet = ensureSheet(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var keys = headers.map(headerToKey);
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(function (row) {
    var obj = {};
    keys.forEach(function (key, i) {
      var v = row[i];
      obj[key] = (v instanceof Date) ? v.toISOString() : v;
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
