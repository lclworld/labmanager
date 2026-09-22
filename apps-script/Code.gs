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
  logActivity(payload.createdBy, "Employee", "Task", id, "Created", "", payload.status || "Not Started", payload.title);
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
  logActivity(payload.updatedBy, payload.tier, "Task", taskId, patch.status ? "Status changed" : "Updated", before.status || "", patch.status || "", "");
  return { status: "ok", taskId: taskId };
}

// ---------- Calendar ----------
function handleCreateCalendarEvent(payload) {
  if (!payload.title || !payload.date) return { status: "error", message: "Title and date are required" };
  var id = createRecord("Calendar", payload);
  logActivity(payload.createdBy, "Employee", "Calendar", id, "Created", "", payload.status || "Scheduled", payload.title);
  return { status: "ok", eventId: id };
}

function handleUpdateCalendarEvent(payload) {
  var eventId = payload.eventId;
  if (!eventId) return { status: "error", message: "eventId is required" };
  var before = getRowById("Calendar", eventId);
  if (!before) return { status: "error", message: "Event not found: " + eventId };
  var patch = payload.patch || {};
  updateRecord("Calendar", eventId, patch);
  logActivity(payload.updatedBy || "", "", "Calendar", eventId, "Updated", before.status || "", patch.status || "", "");
  return { status: "ok", eventId: eventId };
}

// ---------- Director Attention ----------
function handleFlagDirectorAttention(payload) {
  if (!payload.issue) return { status: "error", message: "Issue is required" };
  var id = createRecord("DirectorAttention", payload);
  logActivity(payload.flaggedBy, "Employee", "DirectorAttention", id, "Flagged", "", "Open", payload.issue);
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
  logActivity(payload.createdBy, "Employee", "Communication", id, "Created", "", payload.status || "Open", payload.type || "");
  return { status: "ok", communicationId: id };
}

function handleUpdateCommunication(payload) {
  var communicationId = payload.communicationId;
  if (!communicationId) return { status: "error", message: "communicationId is required" };
  var before = getRowById("Communications", communicationId);
  if (!before) return { status: "error", message: "Not found: " + communicationId };
  var patch = payload.patch || {};
  updateRecord("Communications", communicationId, patch);
  logActivity(payload.updatedBy || "", "", "Communication", communicationId, "Updated", before.status || "", patch.status || "", "");
  return { status: "ok", communicationId: communicationId };
}

// ---------- Production ----------
function handleCreateProduction(payload) {
  if (!payload.product) return { status: "error", message: "Product is required" };
  var id = createRecord("Production", payload);
  logActivity(payload.createdBy, "Employee", "Production", id, "Created", "", payload.productionStatus || "", payload.product);
  return { status: "ok", productionId: id };
}

function handleUpdateProduction(payload) {
  var productionId = payload.productionId;
  if (!productionId) return { status: "error", message: "productionId is required" };
  var before = getRowById("Production", productionId);
  if (!before) return { status: "error", message: "Production record not found: " + productionId };
  var patch = payload.patch || {};
  updateRecord("Production", productionId, patch);
  var action = payload.blockerOverride ? "Blocker overridden" : (patch.productionStatus ? "Status changed" : "Updated");
  logActivity(payload.updatedBy, payload.tier, "Production", productionId, action, before.productionStatus || "", patch.productionStatus || "", payload.blockerOverride ? (patch.blocker || "") : "");
  return { status: "ok", productionId: productionId };
}

// ---------- Deliveries ----------
function handleCreateDelivery(payload) {
  if (!payload.items) return { status: "error", message: "Items is required" };
  var id = createRecord("Deliveries", payload);
  logActivity(payload.createdBy, "Employee", "Delivery", id, "Created", "", payload.status || "", payload.direction || "");
  return { status: "ok", deliveryId: id };
}

function handleUpdateDelivery(payload) {
  var deliveryId = payload.deliveryId;
  if (!deliveryId) return { status: "error", message: "deliveryId is required" };
  var before = getRowById("Deliveries", deliveryId);
  if (!before) return { status: "error", message: "Delivery not found: " + deliveryId };
  var patch = payload.patch || {};
  updateRecord("Deliveries", deliveryId, patch);
  logActivity(payload.updatedBy || "", "", "Delivery", deliveryId, patch.status ? "Status changed" : "Updated", before.status || "", patch.status || "", "");
  return { status: "ok", deliveryId: deliveryId };
}

// ---------- Purchases ----------
function handleCreatePurchase(payload) {
  if (!payload.item) return { status: "error", message: "Item is required" };
  var id = createRecord("Purchases", payload);
  logActivity(payload.createdBy, "Employee", "Purchase", id, "Created", "", payload.status || "Need Identified", payload.item);
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
  logActivity(payload.updatedBy, payload.tier, "Purchase", purchaseId, patch.status ? "Status changed" : "Updated", before.status || "", patch.status || "", "");
  return { status: "ok", purchaseId: purchaseId };
}
