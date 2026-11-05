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
 * Phase 2 added: health check, dashboard bootstrap counts, and the Users
 * log. Phase 3 added: Tasks, Calendar, Director Attention, and
 * Communications read+write. Phase 4 added: Production, Deliveries, and
 * Purchases read+write. Inventory's ?action=getIngredients/
 * getProductionData calls happen directly from the frontend to
 * Inventory's own deployment — nothing about that integration lives here.
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
      case "getTasks":
        return jsonOut({ status: "ok", tasks: getAllRows("Tasks") });
      case "getCalendar":
        return jsonOut({ status: "ok", events: getAllRows("Calendar") });
      case "getDirectorAttention":
        return jsonOut({ status: "ok", items: getAllRows("DirectorAttention") });
      case "getCommunications":
        return jsonOut({ status: "ok", items: getAllRows("Communications") });
      case "getProduction":
        return jsonOut({ status: "ok", records: getAllRows("Production") });
      case "getDeliveries":
        return jsonOut({ status: "ok", deliveries: getAllRows("Deliveries") });
      case "getPurchases":
        return jsonOut({ status: "ok", purchases: getAllRows("Purchases") });
      case "getActivityLog":
        return jsonOut({ status: "ok", entries: getAllRows("ActivityLog") });
      case "getTeamFund":
        return jsonOut(handleGetTeamFund());
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
      case "createTask":
        return jsonOut(handleCreateTask(payload));
      case "updateTask":
        return jsonOut(handleUpdateTask(payload));
      case "createCalendarEvent":
        return jsonOut(handleCreateCalendarEvent(payload));
      case "updateCalendarEvent":
        return jsonOut(handleUpdateCalendarEvent(payload));
      case "flagDirectorAttention":
        return jsonOut(handleFlagDirectorAttention(payload));
      case "respondDirectorAttention":
        return jsonOut(handleRespondDirectorAttention(payload));
      case "createCommunication":
        return jsonOut(handleCreateCommunication(payload));
      case "updateCommunication":
        return jsonOut(handleUpdateCommunication(payload));
      case "createProduction":
        return jsonOut(handleCreateProduction(payload));
      case "updateProduction":
        return jsonOut(handleUpdateProduction(payload));
      case "createDelivery":
        return jsonOut(handleCreateDelivery(payload));
      case "updateDelivery":
        return jsonOut(handleUpdateDelivery(payload));
      case "createPurchase":
        return jsonOut(handleCreatePurchase(payload));
      case "updatePurchase":
        return jsonOut(handleUpdatePurchase(payload));
      case "archiveRecord":
        return jsonOut(handleArchiveRecord(payload));
      case "logTeamFundTransaction":
        return jsonOut(handleLogTeamFundTransaction(payload));
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

// ---------- Tasks ----------
function handleCreateTask(payload) {
  if (!payload.title) return { status: "error", message: "Title is required" };
  var id = createRecord("Tasks", payload);
  logActivity(payload.createdBy, payload.tier || "Employee", "Task", id, "Created", "", payload.status || "Not Started", payload.title);
  return { status: "ok", taskId: id };
}

function handleUpdateTask(payload) {
  var taskId = payload.taskId;
  if (!taskId) return { status: "error", message: "taskId is required" };
  var before = getRowById("Tasks", taskId);
  if (!before) return { status: "error", message: "Task not found: " + taskId };
  var patch = payload.patch || {};
  if (patch.status === "Completed" && !patch.completedDate) patch.completedDate = new Date().toISOString();
  updateRecord("Tasks", taskId, patch);
  logActivity(payload.updatedBy, payload.tier, "Task", taskId, patch.status ? "Status changed" : "Updated", before.status || "", patch.status || "", before.title || "");
  return { status: "ok", taskId: taskId };
}

// ---------- Calendar ----------
function handleCreateCalendarEvent(payload) {
  if (!payload.title || !payload.date) return { status: "error", message: "Title and date are required" };
  var id = createRecord("Calendar", payload);
  logActivity(payload.createdBy, payload.tier || "Employee", "Calendar", id, "Created", "", payload.status || "Scheduled", payload.title);
  return { status: "ok", eventId: id };
}

function handleUpdateCalendarEvent(payload) {
  var eventId = payload.eventId;
  if (!eventId) return { status: "error", message: "eventId is required" };
  var before = getRowById("Calendar", eventId);
  if (!before) return { status: "error", message: "Event not found: " + eventId };
  var patch = payload.patch || {};
  updateRecord("Calendar", eventId, patch);
  logActivity(payload.updatedBy || "", payload.tier || "", "Calendar", eventId, "Updated", before.status || "", patch.status || "", before.title || "");
  return { status: "ok", eventId: eventId };
}

// ---------- Director Attention ----------
function handleFlagDirectorAttention(payload) {
  if (!payload.issue) return { status: "error", message: "Issue is required" };
  var id = createRecord("DirectorAttention", payload);
  logActivity(payload.flaggedBy, payload.tier || "Employee", "DirectorAttention", id, "Flagged", "", "Open", payload.issue);
  // Telegram.gs is optional; skip the alert if it hasn't been added to the project.
  if (typeof notifyFlagRaised === "function") notifyFlagRaised(id, payload);
  return { status: "ok", attentionId: id };
}

// Manager-tier action in the frontend's role model — like every other tier
// boundary in this app, that's enforced client-side (same PIN-only model
// LCL Inventory uses), not by this endpoint checking a credential.
function handleRespondDirectorAttention(payload) {
  var attentionId = payload.attentionId;
  if (!attentionId) return { status: "error", message: "attentionId is required" };
  var before = getRowById("DirectorAttention", attentionId);
  if (!before) return { status: "error", message: "Not found: " + attentionId };
  var patch = { directorResponse: payload.directorResponse || "", status: payload.newStatus || "Resolved" };
  if (patch.status !== "Open") patch.dateResolved = new Date().toISOString();
  updateRecord("DirectorAttention", attentionId, patch);
  logActivity(payload.respondedBy, "Manager", "DirectorAttention", attentionId, "Director responded", before.status || "", patch.status, patch.directorResponse);
  return { status: "ok", attentionId: attentionId };
}

// ---------- Communications ----------
function handleCreateCommunication(payload) {
  if (!payload.message) return { status: "error", message: "Message is required" };
  var id = createRecord("Communications", payload);
  logActivity(payload.createdBy, payload.tier || "Employee", "Communication", id, "Created", "", payload.status || "Open", payload.type || "");
  return { status: "ok", communicationId: id };
}

function handleUpdateCommunication(payload) {
  var communicationId = payload.communicationId;
  if (!communicationId) return { status: "error", message: "communicationId is required" };
  var before = getRowById("Communications", communicationId);
  if (!before) return { status: "error", message: "Not found: " + communicationId };
  var patch = payload.patch || {};
  updateRecord("Communications", communicationId, patch);
  logActivity(payload.updatedBy || "", payload.tier || "", "Communication", communicationId, "Updated", before.status || "", patch.status || "", (before.recipient || "") + (before.message ? ": " + before.message.slice(0, 50) : ""));
  return { status: "ok", communicationId: communicationId };
}

// ---------- Production ----------
function handleCreateProduction(payload) {
  if (!payload.product) return { status: "error", message: "Product is required" };
  var id = createRecord("Production", payload);
  logActivity(payload.createdBy, payload.tier || "Employee", "Production", id, "Created", "", payload.productionStatus || "", payload.product);
  return { status: "ok", productionId: id };
}

// A single save of this record's edit form can touch several unrelated
// sections at once (readiness, QC & Filling, Post-Production, PID, the
// Overall Status dropdown) — but the form always resends every field
// whether or not the person actually touched it. One combined "Updated"
// log line couldn't say which of those a person actually changed, so each
// section below is logged separately, and only when something in it truly
// differs from the record's prior value.
function handleUpdateProduction(payload) {
  var productionId = payload.productionId;
  if (!productionId) return { status: "error", message: "productionId is required" };
  var before = getRowById("Production", productionId);
  if (!before) return { status: "error", message: "Production record not found: " + productionId };
  var patch = payload.patch || {};
  updateRecord("Production", productionId, patch);

  var user = payload.updatedBy, tier = payload.tier;
  // Every per-section entry carries the batch's own name as its details —
  // without it, each line said only "QC & Filling updated" with nothing
  // to say which batch, which made the Telegram digest read as bare
  // counts instead of something a Manager could actually act on.
  var who = (before.product || "") + (before.client ? " for " + before.client : "");
  var sectionChanged = function (keys) {
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (patch.hasOwnProperty(k) && String(patch[k] || "") !== String(before[k] || "")) return true;
    }
    return false;
  };

  if (payload.blockerOverride) {
    logActivity(user, tier, "Production", productionId, "Blocker overridden", before.productionStatus || "", patch.productionStatus || "", who);
  } else if (patch.hasOwnProperty("productionStatus") && String(patch.productionStatus || "") !== String(before.productionStatus || "")) {
    logActivity(user, tier, "Production", productionId, "Overall Status updated", before.productionStatus || "", patch.productionStatus || "", who);
  }
  if (sectionChanged(["plannedDate"])) {
    logActivity(user, tier, "Production", productionId, "Planned Date updated", "", "", who);
  }
  if (sectionChanged(["packagingReadiness", "labelReadiness", "boxReadiness", "batchSheetStatus", "sopStatus"])) {
    logActivity(user, tier, "Production", productionId, "Packaging, Label, Box & Paperwork Readiness updated", "", "", who);
  }
  if (sectionChanged(["qcStatus", "fillingStatus", "directorReviewStatus"])) {
    logActivity(user, tier, "Production", productionId, "QC & Filling updated", "", "", who);
  }
  if (sectionChanged(["packagingType", "packagingSize", "quantityFilled", "unitWeight", "actualProductionDate"])) {
    logActivity(user, tier, "Production", productionId, "Post-Production updated", "", "", who);
  }
  if (sectionChanged(["pifStatus", "pifLink"])) {
    logActivity(user, tier, "Production", productionId, "PID updated", "", "", who);
  }
  return { status: "ok", productionId: productionId };
}

// ---------- Deliveries ----------
function handleCreateDelivery(payload) {
  if (!payload.items) return { status: "error", message: "Items is required" };
  var id = createRecord("Deliveries", payload);
  logActivity(payload.createdBy, payload.tier || "Employee", "Delivery", id, "Created", "", payload.status || "", (payload.direction || "") + (payload.clientOrSupplier ? " — " + payload.clientOrSupplier : ""));
  return { status: "ok", deliveryId: id };
}

function handleUpdateDelivery(payload) {
  var deliveryId = payload.deliveryId;
  if (!deliveryId) return { status: "error", message: "deliveryId is required" };
  var before = getRowById("Deliveries", deliveryId);
  if (!before) return { status: "error", message: "Delivery not found: " + deliveryId };
  var patch = payload.patch || {};
  updateRecord("Deliveries", deliveryId, patch);
  logActivity(payload.updatedBy || "", payload.tier || "", "Delivery", deliveryId, patch.status ? "Status changed" : "Updated", before.status || "", patch.status || "", (before.direction || "") + (before.clientOrSupplier ? " — " + before.clientOrSupplier : ""));
  return { status: "ok", deliveryId: deliveryId };
}

// ---------- Purchases ----------
function handleCreatePurchase(payload) {
  if (!payload.item) return { status: "error", message: "Item is required" };
  var id = createRecord("Purchases", payload);
  logActivity(payload.createdBy, payload.tier || "Employee", "Purchase", id, "Created", "", payload.status || "Need Identified", payload.item);
  return { status: "ok", purchaseId: id };
}

// Approving a purchase is a Manager-tier action in the frontend's role
// model, enforced client-side like every other tier boundary in this app.
function handleUpdatePurchase(payload) {
  var purchaseId = payload.purchaseId;
  if (!purchaseId) return { status: "error", message: "purchaseId is required" };
  var before = getRowById("Purchases", purchaseId);
  if (!before) return { status: "error", message: "Purchase not found: " + purchaseId };
  var patch = payload.patch || {};
  updateRecord("Purchases", purchaseId, patch);
  logActivity(payload.updatedBy, payload.tier, "Purchase", purchaseId, patch.status ? "Status changed" : "Updated", before.status || "", patch.status || "", (before.item || "") + (before.supplier ? " from " + before.supplier : ""));
  return { status: "ok", purchaseId: purchaseId };
}

// ---------- Team Fund ----------
// A separate, pre-existing Google Sheet — Dr. Efua's own "Company Phone
// Transactions" mobile-money ledger — never one of this project's own
// SCHEMA tabs above. Its ID lives in Script Properties, same as the
// Telegram bot token, since it's real money and shouldn't be hardcoded
// into a file anyone with edit access to this project can read. See
// SETUP.md, "Team Fund".
function getTeamFundSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty("TEAM_FUND_SHEET_ID");
  if (!id) throw new Error('TEAM_FUND_SHEET_ID is not set in Script Properties — see SETUP.md, "Team Fund".');
  var sheet = SpreadsheetApp.openById(id).getSheetByName("Transaction Details");
  if (!sheet) throw new Error('Tab "Transaction Details" not found in the Team Fund spreadsheet.');
  return sheet;
}

// The ledger's own running-balance column (I) already carries the current
// total on its last row with a real number in it — read, never recomputed
// from the whole history (a stray blank/garbled row further up stays
// harmless either way).
function lastTeamFundBalance_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var values = sheet.getRange(2, 9, lastRow - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var v = values[i][0];
    if (v !== "" && v !== null && !isNaN(v)) return Number(v);
  }
  return 0;
}

function handleGetTeamFund() {
  var sheet = getTeamFundSheet_();
  var lastRow = sheet.getLastRow();
  var recent = [];
  if (lastRow >= 2) {
    // This sheet's own timezone, not OC's — it's a separate spreadsheet.
    // Formatting Date cells explicitly (rather than .toISOString(), which
    // reports UTC) avoids the exact "date shifts by a day" bug already
    // found and fixed for Calendar in this project — a plain DATE cell
    // has no real time of its own, so reading it as UTC midnight can
    // land on the wrong calendar day once shifted to a local timezone.
    var tz = sheet.getParent().getSpreadsheetTimeZone();
    var startRow = Math.max(2, lastRow - 24);
    var data = sheet.getRange(startRow, 1, lastRow - startRow + 1, 9).getValues();
    recent = data.map(function (r) {
      return {
        date: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, "yyyy-MM-dd") : String(r[0] || ""),
        time: r[1] instanceof Date ? Utilities.formatDate(r[1], tz, "h:mm a") : String(r[1] || ""),
        name: r[2] || "", number: r[3] || "", purpose: r[4] || "",
        staffName: r[5] || "", credit: r[6] || "", debit: r[7] || "", remaining: r[8] || ""
      };
    }).reverse();
  }
  return { status: "ok", balance: lastTeamFundBalance_(sheet), recent: recent };
}

// Appends one row in the exact same shape a manual entry uses (Date, Time,
// Name, Number, Purpose, Staff Name, Credit, Debit, Remaining Amount) — so
// a transaction logged from OC is indistinguishable, when reconciling the
// phone later, from one typed straight into the Sheet. Locked: two people
// logging at once must never both read the same "last balance" and
// silently drop one transaction.
function handleLogTeamFundTransaction(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getTeamFundSheet_();
    var amount = Number(payload.amount);
    if (!amount || amount <= 0) return { status: "error", message: "A positive amount is required" };
    var isCredit = payload.direction === "in";
    var prevBalance = lastTeamFundBalance_(sheet);
    var newBalance = isCredit ? prevBalance + amount : prevBalance - amount;
    var now = new Date();
    sheet.appendRow([
      now, now,
      payload.name || "", payload.number || "", payload.purpose || "",
      payload.staffName || payload.updatedBy || "",
      isCredit ? amount : "", isCredit ? "" : amount,
      newBalance
    ]);
    logActivity(payload.staffName || payload.updatedBy, payload.tier || "Employee", "TeamFund", "-",
      isCredit ? "Deposit logged" : "Expense logged", "", "",
      (payload.purpose || "") + " — " + amount + (payload.name ? " (" + payload.name + ")" : ""));
    return { status: "ok", balance: newBalance };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Archive (Section 5/24: soft, reversible — never a hard
// delete, so History & Search and the Activity Log stay complete) ----------
var ARCHIVABLE_SHEETS = {
  task: "Tasks", production: "Production", delivery: "Deliveries",
  purchase: "Purchases", communication: "Communications",
  attention: "DirectorAttention", event: "Calendar"
};
function handleArchiveRecord(payload) {
  var sheetName = ARCHIVABLE_SHEETS[payload.recordType];
  if (!sheetName) return { status: "error", message: "Unknown record type: " + payload.recordType };
  var idValue = payload.id;
  if (!idValue) return { status: "error", message: "id is required" };
  var before = getRowById(sheetName, idValue);
  if (!before) return { status: "error", message: "Record not found: " + idValue };
  var archived = payload.archived !== false;
  var patch = { archived: archived ? "Yes" : "No", archivedDate: archived ? new Date().toISOString() : "" };
  updateRecord(sheetName, idValue, patch);
  logActivity(payload.updatedBy, payload.tier, sheetName, idValue, archived ? "Archived" : "Unarchived", "", "", "");
  return { status: "ok" };
}
