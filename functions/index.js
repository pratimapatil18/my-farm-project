const {initializeApp} = require("firebase-admin/app");
const {FieldValue, Timestamp, getFirestore} = require("firebase-admin/firestore");
const {getAuth} = require("firebase-admin/auth");
const {createHash} = require("node:crypto");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

initializeApp({projectId: "my-farm-project-83386"});
const db = getFirestore();
const auth = getAuth();
const REGION = "asia-south1";
const MAX_REPORT_ORDERS = 1000;
const allowedFulfilments = new Set(["delivery", "pickup"]);
const allowedNextStatus = new Set(["confirmed", "fulfilled", "cancelled"]);
const ENQUIRY_WINDOW_MS = 60 * 1000;
const ENQUIRY_MAX_PER_IP = 20;

async function adminOnly(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "This action is restricted to an authorised farm administrator.");
  }
  // Token claims can remain cached after revocation. Check the current server-side
  // user record on every privileged call so revoked/disabled admins lose access now.
  const currentUser = await auth.getUser(request.auth.uid);
  if (currentUser.disabled || currentUser.customClaims?.admin !== true) {
    throw new HttpsError("permission-denied", "This account is not currently authorised as an administrator.");
  }
}

async function limitPublicEnquiry(request) {
  const address = request.rawRequest?.ip || request.rawRequest?.socket?.remoteAddress || "unknown";
  const appId = request.app?.appId || "unknown-app";
  const key = createHash("sha256").update(`${appId}:${address}`).digest("hex");
  const ref = db.collection("_functionRateLimits").doc(`whatsapp-${key}`);
  const now = Date.now();
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() : {};
    const windowStart = Number(previous.windowStart) || now;
    const count = now - windowStart >= ENQUIRY_WINDOW_MS ? 0 : Number(previous.count) || 0;
    if (count >= ENQUIRY_MAX_PER_IP) {
      throw new HttpsError("resource-exhausted", "Too many enquiries from this network. Please wait a minute and try again.");
    }
    transaction.set(ref, {windowStart: count === 0 ? now : windowStart, count: count + 1});
  });
}

function requiredText(value, label, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new HttpsError("invalid-argument", `${label} is required and must be under ${max} characters.`);
  }
  return value.trim();
}

function safeProductId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Use a short lowercase product ID with letters, numbers and hyphens.");
  }
  return value;
}

function parseDate(value, isEnd = false) {
  if (!value) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Report dates must use YYYY-MM-DD format.");
  }
  // Farm reporting uses India Standard Time boundaries.
  const calendarDate = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(calendarDate.valueOf()) || calendarDate.toISOString().slice(0, 10) !== value) {
    throw new HttpsError("invalid-argument", "Report date is invalid.");
  }
  const date = new Date(`${value}T00:00:00+05:30`);
  if (isEnd) date.setTime(date.getTime() + 24 * 60 * 60 * 1000);
  return Timestamp.fromDate(date);
}

function cleanOrderAddress(data, fulfilment) {
  if (fulfilment === "pickup") {
    return {
      type: "pickup",
      text: "101, Neel Arcade, Sector 19, Road No. 17, opposite Shiva Complex, New Panvel, Maharashtra, India"
    };
  }
  const address = data.address || {};
  const clean = {
    type: "delivery",
    flat: requiredText(address.flat, "Flat/house number", 80),
    building: requiredText(address.building, "Building", 120),
    area: requiredText(address.area, "Area", 120),
    city: requiredText(address.city, "City", 80),
    pin: requiredText(address.pin, "PIN code", 6)
  };
  if (address.coordinates && Number.isFinite(address.coordinates.latitude) && Number.isFinite(address.coordinates.longitude)
    && Math.abs(address.coordinates.latitude) <= 90 && Math.abs(address.coordinates.longitude) <= 180) {
    clean.coordinates = {latitude: address.coordinates.latitude, longitude: address.coordinates.longitude};
  }
  return clean;
}

function validateProduct(data) {
  const id = safeProductId(data.id);
  const name = requiredText(data.name, "Product name", 80);
  const category = requiredText(data.category, "Category", 20);
  if (!["fruit", "spice", "vegetable"].includes(category)) {
    throw new HttpsError("invalid-argument", "Category must be fruit, spice or vegetable.");
  }
  const price = Number(data.price);
  if (!Number.isSafeInteger(price) || price < 0 || price > 1000000) {
    throw new HttpsError("invalid-argument", "Price must be a whole rupee amount between 0 and 1,000,000.");
  }
  const stockQuantity = data.stockQuantity;
  if (stockQuantity !== null && (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1000000)) {
    throw new HttpsError("invalid-argument", "Stock must be a whole number or blank if not yet counted.");
  }
  const lowStockThreshold = Number(data.lowStockThreshold ?? 5);
  if (!Number.isSafeInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > 100000) {
    throw new HttpsError("invalid-argument", "Low-stock threshold must be a whole number from 0 to 100,000.");
  }
  const unit = requiredText(data.unit, "Unit", 32);
  const seasonalAvailability = requiredText(data.seasonalAvailability || "seasonal", "Availability", 24);
  if (!["seasonal", "year-round", "unavailable"].includes(seasonalAvailability)) {
    throw new HttpsError("invalid-argument", "Availability must be seasonal, year-round or unavailable.");
  }
  const image = typeof data.image === "string" ? data.image.trim() : "";
  if (image && !(image.startsWith("https://") || /^images\/[a-zA-Z0-9 _().-]+$/.test(image))) {
    throw new HttpsError("invalid-argument", "Image must be an HTTPS image URL or a path inside the images folder.");
  }
  return {
    id, name, category, price, unit, stockQuantity, lowStockThreshold,
    seasonalAvailability, active: data.active !== false,
    emoji: requiredText(data.emoji || "🌱", "Product visual", 8),
    image,
    imageAlt: typeof data.imageAlt === "string" ? data.imageAlt.trim().slice(0, 180) : "",
    imageSource: data.imageSource === "stock" ? "stock" : "farm",
    color: /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : "#e8edcf",
    badge: requiredText(data.badge || "SEASONAL", "Product badge", 28),
    updatedAt: FieldValue.serverTimestamp()
  };
}

function publicCatalogRecord(product) {
  return {
    name: product.name, category: product.category, price: product.price, unit: product.unit,
    emoji: product.emoji, image: product.image, imageAlt: product.imageAlt,
    imageSource: product.imageSource, color: product.color, badge: product.badge,
    active: product.active, inStock: product.stockQuantity === null || product.stockQuantity > 0,
    seasonalAvailability: product.seasonalAvailability, updatedAt: FieldValue.serverTimestamp()
  };
}

exports.recordWhatsAppEnquiry = onCall({region: REGION, maxInstances: 5, enforceAppCheck: true}, async request => {
  await limitPublicEnquiry(request);
  const data = request.data || {};
  const customerName = requiredText(data.customerName, "Customer name", 100);
  const mobile = requiredText(data.mobile, "Mobile number", 24);
  if (!/^[0-9+() -]{10,24}$/.test(mobile)) throw new HttpsError("invalid-argument", "Mobile number format is invalid.");
  const fulfilment = data.fulfilment;
  if (!allowedFulfilments.has(fulfilment)) throw new HttpsError("invalid-argument", "Choose delivery or pickup.");
  const address = cleanOrderAddress(data, fulfilment);
  if (fulfilment === "delivery" && !/^\d{6}$/.test(address.pin)) throw new HttpsError("invalid-argument", "PIN code must be 6 digits.");
  const requestedItems = data.items;
  if (!Array.isArray(requestedItems) || requestedItems.length < 1 || requestedItems.length > 20) {
    throw new HttpsError("invalid-argument", "An enquiry must contain between 1 and 20 products.");
  }

  const items = [];
  const requestedProductIds = new Set();
  for (const item of requestedItems) {
    const productId = safeProductId(item?.id);
    if (requestedProductIds.has(productId)) throw new HttpsError("invalid-argument", "Each product may appear only once in the basket.");
    requestedProductIds.add(productId);
    const quantity = Number(item?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new HttpsError("invalid-argument", "Each product quantity must be between 1 and 99.");
    }
    const snapshot = await db.collection("products").doc(productId).get();
    const product = snapshot.data();
    if (!snapshot.exists || product.active === false || product.seasonalAvailability === "unavailable") {
      throw new HttpsError("failed-precondition", `A selected product is currently unavailable (${productId}).`);
    }
    if (Number.isSafeInteger(product.stockQuantity) && product.stockQuantity < quantity) {
      throw new HttpsError("failed-precondition", `Available stock is lower than requested quantity (${productId}).`);
    }
    if (!Number.isSafeInteger(product.price) || product.price < 0) {
      throw new HttpsError("failed-precondition", `A selected product has no valid saved price (${productId}).`);
    }
    items.push({productId, name: product.name, quantity, unit: product.unit, unitPrice: product.price, lineTotal: product.price * quantity});
  }
  const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!Number.isSafeInteger(total)) throw new HttpsError("invalid-argument", "Order total is too large.");
  const order = {
    customer: {name: customerName, mobile, uid: request.auth?.uid || null},
    items, total, fulfilment, address,
    source: "whatsapp",
    status: "whatsapp_enquiry",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
  const ref = await db.collection("orders").add(order);
  return {enquiryId: ref.id, status: order.status, total, items};
});

exports.adminGetDashboard = onCall({region: REGION, maxInstances: 5}, async request => {
  await adminOnly(request);
  const data = request.data || {};
  const start = parseDate(data.startDate);
  const end = parseDate(data.endDate, true);
  if (start && end && start.toMillis() >= end.toMillis()) throw new HttpsError("invalid-argument", "End date must be on or after the start date.");
  // The order table uses creation-date filtering; recorded sales use the date the
  // order was actually fulfilled, which can be later than the enquiry date.
  let query = db.collection("orders").orderBy("createdAt", "desc");
  if (start) query = query.where("createdAt", ">=", start);
  if (end) query = query.where("createdAt", "<", end);
  let fulfilledQuery = db.collection("orders").where("status", "==", "fulfilled").orderBy("fulfilledAt", "desc");
  if (start) fulfilledQuery = fulfilledQuery.where("fulfilledAt", ">=", start);
  if (end) fulfilledQuery = fulfilledQuery.where("fulfilledAt", "<", end);
  const [orderSnapshot, productSnapshot, fulfilledSnapshot] = await Promise.all([
    query.limit(MAX_REPORT_ORDERS + 1).get(),
    db.collection("products").get(),
    fulfilledQuery.limit(MAX_REPORT_ORDERS + 1).get()
  ]);
  if (orderSnapshot.size > MAX_REPORT_ORDERS) {
    throw new HttpsError("resource-exhausted", "This report has more than 1,000 orders. Add paginated reports before using this dataset.");
  }
  if (fulfilledSnapshot.size > MAX_REPORT_ORDERS) {
    throw new HttpsError("resource-exhausted", "This report has more than 1,000 fulfilled orders. Add paginated reports before using this dataset.");
  }
  const toPlain = doc => Object.fromEntries(Object.entries(doc.data()).map(([key, value]) => [
    key,
    value && typeof value.toDate === "function" ? value.toDate().toISOString() : value
  ]).concat([["id", doc.id]]));
  const orders = orderSnapshot.docs.map(toPlain);
  const products = productSnapshot.docs.map(toPlain);
  const completed = fulfilledSnapshot.docs.map(toPlain);
  const bestSelling = new Map();
  for (const order of completed) for (const item of order.items || []) {
    const row = bestSelling.get(item.productId) || {productId: item.productId, name: item.name, quantity: 0, sales: 0};
    row.quantity += item.quantity;
    row.sales += item.lineTotal;
    bestSelling.set(item.productId, row);
  }
  const lowStock = products.filter(p => p.active && Number.isSafeInteger(p.stockQuantity) && p.stockQuantity > 0 && p.stockQuantity <= (p.lowStockThreshold ?? 5));
  const outOfStock = products.filter(p => p.active && p.stockQuantity === 0);
  return {
    orders,
    products,
    stats: {
      orderCount: orders.length,
      enquiryCount: orders.filter(o => o.status === "whatsapp_enquiry").length,
      completedCount: completed.length,
      actualSales: completed.reduce((sum, o) => sum + (Number.isSafeInteger(o.total) ? o.total : 0), 0),
      lowStockCount: lowStock.length,
      outOfStockCount: outOfStock.length,
      uncountedStockCount: products.filter(p => p.active && p.stockQuantity === null).length
    },
    lowStock,
    outOfStock,
    bestSelling: [...bestSelling.values()].sort((a, b) => b.quantity - a.quantity)
  };
});

exports.adminSaveProduct = onCall({region: REGION, maxInstances: 5}, async request => {
  await adminOnly(request);
  const product = validateProduct(request.data || {});
  const {id, ...record} = product;
  const batch = db.batch();
  batch.set(db.collection("products").doc(id), record, {merge: true});
  batch.set(db.collection("catalog").doc(id), publicCatalogRecord(product));
  await batch.commit();
  const response = {...record};
  delete response.updatedAt;
  return {id, ...response};
});

// One-time admin migration for legacy catalogue projection documents. It writes
// only known public fields and hides orphan projections with no inventory source.
exports.adminRefreshPublicCatalog = onCall({region: REGION, maxInstances: 2}, async request => {
  await adminOnly(request);
  // Close public catalogue reads before starting a potentially multi-batch
  // migration. If the migration stops midway, it remains closed until retried.
  await db.collection("system").doc("publicCatalog").set({ready: false, updatedAt: FieldValue.serverTimestamp()});
  const [productSnapshot, catalogSnapshot] = await Promise.all([
    db.collection("products").get(),
    db.collection("catalog").get()
  ]);
  const productsById = new Map(productSnapshot.docs.map(doc => [doc.id, doc.data()]));
  const publicFields = ["name", "category", "price", "unit", "emoji", "image", "imageAlt", "imageSource", "color", "badge", "active", "inStock", "seasonalAvailability"];
  const catalogById = new Map(catalogSnapshot.docs.map(doc => [doc.id, doc.data()]));
  const ids = new Set([...productsById.keys(), ...catalogById.keys()]);
  const operations = [...ids].map(id => {
    const product = productsById.get(id);
    const existing = catalogById.get(id) || {};
    const data = product ? publicCatalogRecord(product) : Object.fromEntries(publicFields
      .filter(field => field in existing)
      .map(field => [field, existing[field]]));
    if (!product) data.active = false;
    data.updatedAt = FieldValue.serverTimestamp();
    return {ref: db.collection("catalog").doc(id), data};
  });
  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = db.batch();
    for (const operation of operations.slice(offset, offset + 450)) batch.set(operation.ref, operation.data);
    await batch.commit();
  }
  await db.collection("system").doc("publicCatalog").set({
    ready: true,
    updatedAt: FieldValue.serverTimestamp(),
    productCount: productSnapshot.size
  });
  return {updated: productSnapshot.size, sanitizedLegacy: catalogSnapshot.size};
});

exports.adminSetOrderStatus = onCall({region: REGION, maxInstances: 5}, async request => {
  await adminOnly(request);
  const {orderId, status} = request.data || {};
  if (typeof orderId !== "string" || !/^[A-Za-z0-9_-]{16,40}$/.test(orderId)) throw new HttpsError("invalid-argument", "Order ID is invalid.");
  if (!allowedNextStatus.has(status)) throw new HttpsError("invalid-argument", "Choose confirmed, fulfilled or cancelled.");
  const orderRef = db.collection("orders").doc(orderId);
  await db.runTransaction(async transaction => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order was not found.");
    const order = orderSnap.data();
    const allowedTransitions = order.status === "whatsapp_enquiry"
      ? new Set(["confirmed", "cancelled"])
      : order.status === "confirmed"
        ? new Set(["fulfilled", "cancelled"])
        : new Set();
    if (!allowedTransitions.has(status)) {
      throw new HttpsError("failed-precondition", "This order is already final and cannot be changed.");
    }
    if (status === "fulfilled") {
      const productRefs = (order.items || []).map(item => db.collection("products").doc(item.productId));
      const snapshots = [];
      for (const ref of productRefs) snapshots.push(await transaction.get(ref));
      for (let index = 0; index < productRefs.length; index++) {
        const product = snapshots[index].data();
        if (Number.isSafeInteger(product?.stockQuantity) && product.stockQuantity < order.items[index].quantity) {
          throw new HttpsError("failed-precondition", `Not enough stock to complete ${product?.name || order.items[index].productId}.`);
        }
      }
      for (let index = 0; index < productRefs.length; index++) {
        const product = snapshots[index].data();
        if (Number.isSafeInteger(product?.stockQuantity)) {
          const nextStock = product.stockQuantity - order.items[index].quantity;
          transaction.update(productRefs[index], {stockQuantity: nextStock, updatedAt: FieldValue.serverTimestamp()});
          transaction.set(db.collection("catalog").doc(order.items[index].productId), publicCatalogRecord({
            ...product, stockQuantity: nextStock
          }));
        }
      }
    }
    transaction.update(orderRef, {status, updatedAt: FieldValue.serverTimestamp(), ...(status === "fulfilled" ? {fulfilledAt: FieldValue.serverTimestamp()} : {})});
  });
  return {orderId, status};
});
