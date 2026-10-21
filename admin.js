import "./firebase-client.js";
import {downloadCsv} from "./admin-report-utils.js";
import {EmailAuthProvider, getIdTokenResult, onAuthStateChanged, reauthenticateWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updatePassword} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

const $ = selector => document.querySelector(selector);
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const emulatorMode = isLocal && new URLSearchParams(location.search).get("emulator") === "1";
const loginPanel = $("#admin-login-panel");
const deniedPanel = $("#admin-denied-panel");
const dashboard = $("#admin-dashboard");
const loginStatus = $("#admin-login-status");
const dataStatus = $("#admin-data-status");
const inventoryRows = $("#inventory-rows");
const orderRows = $("#order-rows");
const form = $("#product-form");
const adminPassword = $("#admin-password");
const changePasswordForm = $("#admin-change-password-form");
const changePasswordToggle = $("#admin-change-password-toggle");
let auth;
let functions;
let dashboardCall;
let saveProductCall;
let setOrderStatusCall;
let reportData = null;
let activeAdminUid = null;

function setStatus(element, message, kind = "info") {
  element.textContent = message;
  element.dataset.kind = kind;
}

function closePasswordChangeForm({clearStatus = false, reset = false} = {}) {
  changePasswordForm.hidden = true;
  changePasswordToggle.textContent = "Change password";
  changePasswordToggle.setAttribute("aria-expanded", "false");
  if (reset) changePasswordForm.reset();
  if (clearStatus) setStatus($("#admin-password-status"), "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {style:"currency", currency:"INR", maximumFractionDigits:0}).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("en-IN", {dateStyle:"medium", timeStyle:"short", timeZone:"Asia/Kolkata"}).format(date);
}

function reportError(error) {
  const code = error?.code ? ` (${error.code})` : "";
  const message = error?.message || "The request failed.";
  return `${message}${code}`;
}

function istDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"}).format(value);
}

function initializeReportDates() {
  const today = istDate();
  $("#report-to").value = today;
  $("#report-from").value = `${today.slice(0, 7)}-01`;
}

function setPeriod(period) {
  const today = istDate();
  if (period === "daily") {
    $("#report-from").value = today;
    $("#report-to").value = today;
  } else if (period === "monthly") {
    $("#report-from").value = `${today.slice(0, 7)}-01`;
    $("#report-to").value = today;
  }
}

function setLoggedOut(message = "") {
  closePasswordChangeForm({clearStatus:true, reset:true});
  loginPanel.hidden = false;
  deniedPanel.hidden = true;
  dashboard.hidden = true;
  setStatus(loginStatus, message);
}

function showDenied(message = "Only an account granted the admin role by the trusted backend can use this dashboard.") {
  loginPanel.hidden = true;
  dashboard.hidden = true;
  deniedPanel.hidden = false;
  $("#admin-denied-message").textContent = message;
}

function fillProductForm(product = null) {
  form.reset();
  form.hidden = false;
  $("#product-form-title").textContent = product ? "Edit product" : "Add product";
  $("#product-original-id").value = product?.id || "";
  $("#product-id").value = product?.id || "";
  $("#product-id").readOnly = Boolean(product);
  $("#product-name").value = product?.name || "";
  $("#product-category").value = product?.category || "fruit";
  $("#product-price").value = product?.price ?? "";
  $("#product-unit").value = product?.unit || "per kg";
  $("#product-stock").value = Number.isSafeInteger(product?.stockQuantity) ? product.stockQuantity : "";
  $("#product-threshold").value = product?.lowStockThreshold ?? 5;
  $("#product-availability").value = product?.seasonalAvailability || "seasonal";
  $("#product-badge").value = product?.badge || "SEASONAL";
  $("#product-emoji").value = product?.emoji || "🌱";
  $("#product-color").value = product?.color || "#e8edcf";
  $("#product-image-source").value = product?.imageSource === "stock" ? "stock" : "farm";
  $("#product-image").value = product?.image || "";
  $("#product-image-alt").value = product?.imageAlt || "";
  $("#product-active").checked = product?.active !== false;
  form.scrollIntoView({behavior:"smooth", block:"center"});
}

function renderInventory(products) {
  if (!products.length) {
    inventoryRows.innerHTML = '<tr><td colspan="7">No catalogue records yet. Seed the existing catalogue in the Firestore emulator first.</td></tr>';
    return;
  }
  inventoryRows.innerHTML = products.map(product => {
    const stock = Number.isSafeInteger(product.stockQuantity) ? product.stockQuantity : null;
    const stockLabel = stock === null ? "Not counted" : stock === 0 ? "Out of stock" : stock <= (product.lowStockThreshold ?? 5) ? `${stock} · Low` : String(stock);
    const state = product.active === false ? "Inactive" : product.seasonalAvailability || "Seasonal";
    return `<tr>
      <td><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.id)} · ${escapeHtml(product.category)}</small></td>
      <td>${formatMoney(product.price)}</td><td>${escapeHtml(product.unit)}</td>
      <td>${escapeHtml(stockLabel)}</td><td>${escapeHtml(state)}</td>
      <td>${product.active === false ? "Inactive" : "Active"}</td>
      <td><button class="table-action" data-edit-product="${escapeHtml(product.id)}" type="button">Edit</button>${product.active === false ? "" : `<button class="table-action" data-deactivate-product="${escapeHtml(product.id)}" type="button">Deactivate</button>`}</td>
    </tr>`;
  }).join("");
}

function displayAddress(order) {
  const address = order.address || {};
  if (order.fulfilment === "pickup") return address.text || "Farm pickup";
  return [address.flat, address.building, address.area, address.city, address.pin].filter(Boolean).join(", ") || "Address not recorded";
}

function renderOrders(orders) {
  if (!orders.length) {
    orderRows.innerHTML = '<tr><td colspan="7">No recorded enquiries or orders in this date range.</td></tr>';
    return;
  }
  orderRows.innerHTML = orders.map(order => {
    const items = (order.items || []).map(item => `${escapeHtml(item.name)} × ${escapeHtml(item.quantity)}`).join("; ");
    const status = order.status || "whatsapp_enquiry";
    const isFinal = ["fulfilled", "cancelled"].includes(status);
    const nextStatuses = status === "whatsapp_enquiry" ? ["confirmed", "cancelled"] : ["fulfilled", "cancelled"];
    const options = [`<option value="${escapeHtml(status)}" selected>${escapeHtml(status.replaceAll("_", " "))} (current)</option>`, ...nextStatuses.map(value => `<option value="${value}">${escapeHtml(value.replaceAll("_", " "))}</option>`)].join("");
    return `<tr>
      <td>${escapeHtml(formatDate(order.createdAt))}<small>${escapeHtml(order.source || "recorded")}</small></td>
      <td><strong>${escapeHtml(order.customer?.name)}</strong><small>${escapeHtml(order.customer?.mobile)}</small></td>
      <td>${items || "—"}</td><td>${formatMoney(order.total)}<small>Estimate until fulfilled</small></td>
      <td>${escapeHtml(order.fulfilment)}<small>${escapeHtml(displayAddress(order))}</small></td>
      <td>${escapeHtml(status.replaceAll("_", " "))}</td>
      <td>${isFinal ? "Final" : `<select class="order-status-select" data-order-status="${escapeHtml(order.id)}">${options}</select><button class="table-action" data-save-order="${escapeHtml(order.id)}" type="button">Apply</button>`}</td>
    </tr>`;
  }).join("");
}

function renderBestSelling(rows) {
  const target = $("#best-selling-rows");
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="3">No fulfilled sales in this date range.</td></tr>';
    return;
  }
  target.innerHTML = rows.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.quantity)}</td><td>${formatMoney(row.sales)}</td></tr>`).join("");
}

function renderDashboard(data) {
  reportData = data;
  $("#stat-orders").textContent = data.stats.orderCount;
  $("#stat-sales").textContent = formatMoney(data.stats.actualSales);
  $("#stat-low-stock").textContent = data.stats.lowStockCount;
  $("#stat-out-stock").textContent = data.stats.outOfStockCount;
  $("#stock-unknown-note").textContent = `${data.stats.uncountedStockCount} active products still have uncounted stock. These are excluded from low-stock and out-of-stock totals.`;
  renderInventory(data.products);
  renderOrders(data.orders);
  renderBestSelling(data.bestSelling);
}

async function refreshDashboard() {
  setStatus(dataStatus, "Loading inventory and reports…");
  $("#report-refresh").disabled = true;
  try {
    const response = await dashboardCall({startDate:$("#report-from").value, endDate:$("#report-to").value});
    renderDashboard(response.data);
  setStatus(dataStatus, "Data loaded. Recorded sales include only orders marked fulfilled; payment is not verified by this website.");
  } catch (error) {
    setStatus(dataStatus, reportError(error), "error");
  } finally {
    $("#report-refresh").disabled = false;
  }
}

async function activateAdmin(user) {
  const token = await getIdTokenResult(user, true);
  if (token.claims.admin !== true) {
    await signOut(auth);
    showDenied("This account is a customer or has not received the server-controlled admin claim. No admin data was loaded.");
    return false;
  }
  closePasswordChangeForm({clearStatus:true, reset:true});
  if (activeAdminUid === user.uid) return true;
  activeAdminUid = user.uid;
  dashboard.hidden = false;
  loginPanel.hidden = true;
  deniedPanel.hidden = true;
  $("#admin-current-user").textContent = user.email || "Authorised administrator";
  initializeReportDates();
  await refreshDashboard();
  return true;
}

function exportCsv(filename, rows) {
  if (!rows.length) {
    setStatus(dataStatus, "There are no rows to export for the current selection.", "error");
    return;
  }
  downloadCsv(filename, rows);
}

function localFunctionsReady(app) {
  functions = getFunctions(app, "asia-south1");
  if (emulatorMode) {
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }
  dashboardCall = httpsCallable(functions, "adminGetDashboard");
  saveProductCall = httpsCallable(functions, "adminSaveProduct");
  setOrderStatusCall = httpsCallable(functions, "adminSetOrderStatus");
}

$("#admin-login-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (isLocal && !emulatorMode) {
    setStatus(loginStatus, "For safe local testing, open admin.html?emulator=1 after starting the Firebase emulators. This page will not sign in to the live project from localhost.", "error");
    return;
  }
  const button = $("#admin-login-button");
  button.disabled = true;
  setStatus(loginStatus, "Signing in and checking the admin role…");
  try {
    const credential = await signInWithEmailAndPassword(auth, $("#admin-email").value.trim(), $("#admin-password").value);
    await activateAdmin(credential.user);
  } catch (error) {
    setStatus(loginStatus, reportError(error), "error");
  } finally {
    button.disabled = false;
  }
});

$("#admin-password-toggle").addEventListener("click", event => {
  const button = event.currentTarget;
  const showingPassword = adminPassword.type === "password";
  adminPassword.type = showingPassword ? "text" : "password";
  button.textContent = showingPassword ? "Hide" : "Show";
  button.setAttribute("aria-pressed", String(showingPassword));
  button.setAttribute("aria-label", `${showingPassword ? "Hide" : "Show"} admin password`);
});

$("#admin-password-reset").addEventListener("click", async event => {
  const button = event.currentTarget;
  const emailInput = $("#admin-email");
  const email = emailInput.value.trim();
  if (!email) {
    setStatus(loginStatus, "Enter your admin email address first.", "error");
    emailInput.focus();
    return;
  }
  if (!emailInput.checkValidity()) {
    emailInput.reportValidity();
    return;
  }
  if (!auth) {
    setStatus(loginStatus, isLocal ? "Firebase is not ready. Confirm the local Auth Emulator is running and open this page with ?emulator=1." : "Firebase Authentication is not ready. Please try again.", "error");
    return;
  }

  button.disabled = true;
  setStatus(loginStatus, "Requesting a password reset…");
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus(loginStatus, emulatorMode
      ? "Reset request accepted by the local Auth Emulator. No email was sent; check the Emulator UI or Auth Emulator out-of-band codes."
      : "If an account uses this email, Firebase will send password reset instructions. Check your inbox and spam folder.");
  } catch (error) {
    const messages = {
      "auth/invalid-email": "Enter a valid email address.",
      "auth/operation-not-allowed": "Password reset is not enabled for this Firebase Authentication project.",
      "auth/too-many-requests": "Too many reset attempts. Wait a while and try again.",
      "auth/network-request-failed": "Could not reach Firebase. Check your connection and try again."
    };
    const message = messages[error?.code] || `Password reset could not be requested${error?.code ? ` (${error.code})` : ""}. Please try again.`;
    setStatus(loginStatus, message, "error");
  } finally {
    button.disabled = false;
  }
});

changePasswordToggle.addEventListener("click", () => {
  const opening = changePasswordForm.hidden;
  changePasswordForm.hidden = !opening;
  changePasswordToggle.textContent = opening ? "Cancel" : "Change password";
  changePasswordToggle.setAttribute("aria-expanded", String(opening));
  if (opening) {
    setStatus($("#admin-password-status"), "");
    $("#admin-current-password").focus();
  }
});

changePasswordForm.addEventListener("submit", async event => {
  event.preventDefault();
  const user = auth?.currentUser;
  const status = $("#admin-password-status");
  const button = $("#admin-change-password-button");
  const currentPassword = $("#admin-current-password").value;
  const newPassword = $("#admin-new-password").value;
  const confirmPassword = $("#admin-confirm-password").value;

  if (!user || user.email == null) {
    setStatus(status, "Your admin session is no longer available. Sign in again and retry.", "error");
    return;
  }
  if (newPassword.length < 8) {
    setStatus(status, "Choose a new password with at least 8 characters.", "error");
    return;
  }
  if (newPassword !== confirmPassword) {
    setStatus(status, "The new password and confirmation do not match.", "error");
    return;
  }

  button.disabled = true;
  setStatus(status, "Verifying your current password…");
  try {
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, newPassword);
    changePasswordForm.reset();
    setStatus(status, "Your password was updated successfully.");
    closePasswordChangeForm();
  } catch (error) {
    const messages = {
      "auth/wrong-password": "The current password is incorrect. Please try again.",
      "auth/invalid-credential": "The current password is incorrect. Please try again.",
      "auth/weak-password": "Choose a stronger password with at least 8 characters.",
      "auth/requires-recent-login": "For your security, sign out and sign in again before changing your password.",
      "auth/too-many-requests": "Too many attempts. Wait a while and try again.",
      "auth/network-request-failed": "Could not reach Firebase. Check your connection and try again."
    };
    setStatus(status, messages[error?.code] || `Password could not be changed${error?.code ? ` (${error.code})` : ""}. Please try again.`, "error");
  } finally {
    button.disabled = false;
  }
});

$("#admin-signout").addEventListener("click", async () => { await signOut(auth); setLoggedOut("You have signed out."); });
$("#admin-denied-signout").addEventListener("click", async () => { await signOut(auth); setLoggedOut("You have signed out."); });
$("#report-refresh").addEventListener("click", refreshDashboard);
$("#report-period").addEventListener("change", event => setPeriod(event.target.value));
$("#new-product").addEventListener("click", () => fillProductForm());
$("#product-cancel").addEventListener("click", () => { form.hidden = true; });

form.addEventListener("submit", async event => {
  event.preventDefault();
  const payload = {
    id:$("#product-id").value.trim(), name:$("#product-name").value.trim(), category:$("#product-category").value,
    price:Number($("#product-price").value), unit:$("#product-unit").value.trim(),
    stockQuantity:$("#product-stock").value === "" ? null : Number($("#product-stock").value),
    lowStockThreshold:Number($("#product-threshold").value), seasonalAvailability:$("#product-availability").value,
    badge:$("#product-badge").value.trim(), emoji:$("#product-emoji").value.trim(), color:$("#product-color").value,
    imageSource:$("#product-image-source").value, image:$("#product-image").value.trim(), imageAlt:$("#product-image-alt").value.trim(),
    active:$("#product-active").checked
  };
  if ($( "#product-original-id").value) payload.id = $("#product-original-id").value;
  const button = $("#product-save");
  button.disabled = true;
  try {
    await saveProductCall(payload);
    form.hidden = true;
    setStatus(dataStatus, "Product saved. The customer catalogue will use this record when the approved product-read rules are active.");
    await refreshDashboard();
  } catch (error) {
    setStatus(dataStatus, reportError(error), "error");
  } finally {
    button.disabled = false;
  }
});

inventoryRows.addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit-product]");
  const deactivate = event.target.closest("[data-deactivate-product]");
  if (edit) fillProductForm(reportData.products.find(product => product.id === edit.dataset.editProduct));
  if (deactivate) {
    const product = reportData.products.find(item => item.id === deactivate.dataset.deactivateProduct);
    if (!product) return;
    try {
      await saveProductCall({...product, active:false});
      setStatus(dataStatus, `${product.name} deactivated.`);
      await refreshDashboard();
    } catch (error) {
      setStatus(dataStatus, reportError(error), "error");
    }
  }
});

orderRows.addEventListener("click", async event => {
  const button = event.target.closest("[data-save-order]");
  if (!button) return;
  const select = orderRows.querySelector(`[data-order-status="${CSS.escape(button.dataset.saveOrder)}"]`);
  if (!select) return;
  button.disabled = true;
  try {
    await setOrderStatusCall({orderId:button.dataset.saveOrder, status:select.value});
    setStatus(dataStatus, "Order status saved.");
    await refreshDashboard();
  } catch (error) {
    setStatus(dataStatus, reportError(error), "error");
  } finally {
    button.disabled = false;
  }
});

$("#export-report").addEventListener("click", () => {
  if (!reportData) return;
  const rows = [["Order ID", "Created (IST)", "Status", "Customer", "Mobile", "Items", "Price snapshot total INR", "Counts as recorded fulfilled sale", "Fulfilment", "Address"]];
  for (const order of reportData.orders) rows.push([
    order.id, formatDate(order.createdAt), order.status, order.customer?.name, order.customer?.mobile,
    (order.items || []).map(item => `${item.name} x ${item.quantity} @ ${item.unitPrice}`).join("; "),
    order.total, order.status === "fulfilled" ? "yes" : "no", order.fulfilment, displayAddress(order)
  ]);
  exportCsv(`farm-orders-${$("#report-from").value}-to-${$("#report-to").value}.csv`, rows);
});

$("#export-inventory").addEventListener("click", () => {
  if (!reportData) return;
  const rows = [["Product ID", "Name", "Category", "Price INR", "Unit", "Stock", "Low stock threshold", "Availability", "Active"]];
  for (const product of reportData.products) rows.push([product.id, product.name, product.category, product.price, product.unit, product.stockQuantity ?? "not counted", product.lowStockThreshold, product.seasonalAvailability, product.active]);
  exportCsv("farm-inventory.csv", rows);
});

const clientResult = await window.firebaseClientReady;
if (clientResult.status !== "ready") {
  setStatus(loginStatus, isLocal && !emulatorMode
    ? "Local admin sign-in is disabled to protect production. Start the emulators and open admin.html?emulator=1 to test locally."
    : "Firebase did not initialize. Check the browser console and try again.", "error");
} else {
  auth = clientResult.auth;
  localFunctionsReady(clientResult.app);
  onAuthStateChanged(auth, async user => {
    if (!user) {
      activeAdminUid = null;
      if (dashboard.hidden === false || deniedPanel.hidden === false) setLoggedOut();
      return;
    }
    try {
      await activateAdmin(user);
    } catch {
      showDenied("Could not verify this account’s admin claim. No admin data was loaded.");
    }
  });
}
