import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {after, before, test} from "node:test";
import {initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword} from "firebase/auth";
import {CustomProvider, initializeAppCheck} from "firebase/app-check";
import {collection, connectFirestoreEmulator, getDocs, getFirestore as getWebFirestore, query, where} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";
import {getAuth as getAdminAuth} from "firebase-admin/auth";
import {getFirestore as getAdminFirestore, Timestamp} from "firebase-admin/firestore";
import {initializeApp as initializeAdminApp} from "firebase-admin/app";

const projectId = "my-farm-project-83386";
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const functionsEmulatorHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const password = `FarmTest!${randomBytes(16).toString("hex")}`;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminSdkApp;
let adminSdkAuth;
let db;
let customerAuth;
let guestAuth;
let rateAuth;
let noCheckAuth;
let adminWebAuth;
let customerCalls;
let publicDb;
let guestCalls;
let noCheckCalls;
let adminCalls;
let productSave;
let dashboard;
let orderStatus;
let recordEnquiry;
let orderId;
const extraOrderIds = [];
const extraCatalogIds = [];
let customerUid;
let adminUid;
const testProductIds = {
  mango: `mango-test-${suffix}`,
  lowStock: `low-test-${suffix}`,
  outOfStock: `empty-test-${suffix}`
};

function makeFunctions(app) {
  const functions = getFunctions(app, "asia-south1");
  const [host, port] = functionsEmulatorHost.split(":");
  connectFunctionsEmulator(functions, host, Number(port));
  return functions;
}

function makeWebApp(name) {
  const app = initializeApp({projectId, apiKey:"emulator-test-key", appId:`1:${name}:web:test`}, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authEmulatorHost}`, {disableWarnings:true});
  if (name.startsWith("guest-")) {
    const appId = `test-${name}-${suffix}`;
    const payload = Buffer.from(JSON.stringify({sub:appId, app_id:appId, exp:Math.floor(Date.now() / 1000) + 3600})).toString("base64url");
    const token = `e30.${payload}.emulator-test-signature`;
    initializeAppCheck(app, {provider:new CustomProvider({getToken:async () => ({token, expireTimeMillis:Date.now() + 3600000})})});
  }
  return {app, auth};
}

async function expectCallableError(promise, code) {
  await assert.rejects(promise, error => error?.code === `functions/${code}`,
    `Expected callable error functions/${code}`);
}

before(async () => {
  adminSdkApp = initializeAdminApp({projectId}, `admin-integration-${suffix}`);
  adminSdkAuth = getAdminAuth(adminSdkApp);
  db = getAdminFirestore(adminSdkApp);

  const customer = makeWebApp(`customer-${suffix}`);
  customerAuth = customer.auth;
  customerCalls = makeFunctions(customer.app);

  const guest = makeWebApp(`guest-${suffix}`);
  guestAuth = guest.auth;
  guestCalls = makeFunctions(guest.app);
  publicDb = getWebFirestore(guest.app);
  const [firestoreHost, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
  connectFirestoreEmulator(publicDb, firestoreHost, Number(firestorePort));
  const noCheck = makeWebApp(`no-check-${suffix}`);
  noCheckAuth = noCheck.auth;
  noCheckCalls = makeFunctions(noCheck.app);

  const admin = makeWebApp(`admin-${suffix}`);
  adminWebAuth = admin.auth;
  adminCalls = makeFunctions(admin.app);

  const customerCredential = await createUserWithEmailAndPassword(customerAuth, `customer-${suffix}@example.test`, password);
  customerUid = customerCredential.user.uid;
  const adminUser = await adminSdkAuth.createUser({email:`admin-${suffix}@example.test`, password});
  adminUid = adminUser.uid;
  await adminSdkAuth.setCustomUserClaims(adminUser.uid, {admin:true});
  await signInWithEmailAndPassword(adminWebAuth, adminUser.email, password);
});

after(async () => {
  if (db) {
    const batch = db.batch();
    for (const id of Object.values(testProductIds)) {
      batch.delete(db.collection("products").doc(id));
      batch.delete(db.collection("catalog").doc(id));
    }
    if (orderId) batch.delete(db.collection("orders").doc(orderId));
    for (const id of extraOrderIds) batch.delete(db.collection("orders").doc(id));
    for (const id of extraCatalogIds) batch.delete(db.collection("catalog").doc(id));
    await batch.commit().catch(() => {});
  }
  if (customerUid) await adminSdkAuth.deleteUser(customerUid).catch(() => {});
  if (adminUid) await adminSdkAuth.deleteUser(adminUid).catch(() => {});
  for (const auth of [customerAuth, guestAuth, rateAuth, adminWebAuth, noCheckAuth]) {
    if (auth?.app) await (await import("firebase/app")).deleteApp(auth.app).catch(() => {});
  }
  if (adminSdkApp) await adminSdkApp.delete();
});

test("customer is denied admin operations; authorized admin manages inventory, orders and reports", async () => {
  const customerSave = httpsCallable(customerCalls, "adminSaveProduct");
  const customerDashboard = httpsCallable(customerCalls, "adminGetDashboard");
  const customerStatus = httpsCallable(customerCalls, "adminSetOrderStatus");
  await expectCallableError(httpsCallable(guestCalls, "adminGetDashboard")({}), "unauthenticated");
  await expectCallableError(customerDashboard({}), "permission-denied");
  await expectCallableError(customerSave({id:"not-authorized", name:"No", category:"fruit", price:1, unit:"kg", stockQuantity:1}), "permission-denied");
  await expectCallableError(customerStatus({orderId:"aaaaaaaaaaaaaaaa", status:"confirmed"}), "permission-denied");

  productSave = httpsCallable(adminCalls, "adminSaveProduct");
  dashboard = httpsCallable(adminCalls, "adminGetDashboard");
  orderStatus = httpsCallable(adminCalls, "adminSetOrderStatus");
  const refreshCatalog = httpsCallable(adminCalls, "adminRefreshPublicCatalog");
  recordEnquiry = httpsCallable(guestCalls, "recordWhatsAppEnquiry");
  await expectCallableError(httpsCallable(noCheckCalls, "recordWhatsAppEnquiry")({}), "unauthenticated");

  await db.collection("catalog").doc(testProductIds.mango).set({stockQuantity:10, supplierSecret:"private", costPrice:12, legacyAdminNote:"remove me"});
  await productSave({id:testProductIds.mango, name:"Test mangoes", category:"fruit", price:180, unit:"per kg", stockQuantity:10, lowStockThreshold:2, seasonalAvailability:"seasonal", active:true, badge:"TEST", emoji:"🥭", color:"#f5e8bd"});
  const publicProjection = (await db.collection("catalog").doc(testProductIds.mango).get()).data();
  for (const field of ["stockQuantity", "supplierSecret", "costPrice", "legacyAdminNote"]) {
    assert.equal(field in publicProjection, false, `catalogue projection must remove ${field}`);
  }
  await db.collection("catalog").doc(testProductIds.mango).set({stockQuantity:8, supplierSecret:"old private data"}, {merge:true});
  const orphanId = `orphan-${suffix}`;
  extraCatalogIds.push(orphanId);
  await db.collection("catalog").doc(orphanId).set({name:"Orphan", active:true, stockQuantity:99});
  await assert.rejects(
    getDocs(query(collection(publicDb, "catalog"), where("active", "==", true))),
    error => error?.code === "permission-denied",
    "catalogue stays closed until the admin migration finishes"
  );
  const refreshed = (await refreshCatalog({})).data;
  assert.equal(refreshed.updated >= 1, true);
  assert.equal(refreshed.sanitizedLegacy >= 1, true);
  assert.equal((await db.collection("system").doc("publicCatalog").get()).data().ready, true);
  const migratedProjection = (await db.collection("catalog").doc(testProductIds.mango).get()).data();
  assert.equal("stockQuantity" in migratedProjection, false, "admin migration removes legacy private fields");
  const sanitizedOrphan = (await db.collection("catalog").doc(orphanId).get()).data();
  assert.equal("stockQuantity" in sanitizedOrphan, false, "admin migration strips private fields from legacy orphan projections");
  assert.equal(sanitizedOrphan.active, false, "orphan projections are hidden from customers");
  const publicSnapshot = await getDocs(query(collection(publicDb, "catalog"), where("active", "==", true)));
  for (const publicDoc of publicSnapshot.docs) {
    const fields = publicDoc.data();
    for (const privateField of ["stockQuantity", "lowStockThreshold", "supplierSecret", "costPrice", "legacyAdminNote"]) {
      assert.equal(privateField in fields, false, `public catalogue query must not expose ${privateField}`);
    }
  }
  await productSave({id:testProductIds.lowStock, name:"Low test stock", category:"vegetable", price:25, unit:"bunch", stockQuantity:2, lowStockThreshold:5, seasonalAvailability:"year-round", active:true, badge:"TEST", emoji:"🌿", color:"#e8edcf"});
  await productSave({id:testProductIds.outOfStock, name:"Empty test stock", category:"fruit", price:25, unit:"piece", stockQuantity:0, lowStockThreshold:5, seasonalAvailability:"seasonal", active:true, badge:"TEST", emoji:"🍐", color:"#e8edcf"});

  await expectCallableError(productSave({id:"fraction-price", name:"Invalid price", category:"fruit", price:1.5, unit:"kg", stockQuantity:1}), "invalid-argument");
  await expectCallableError(productSave({id:"negative-price", name:"Invalid price", category:"fruit", price:-1, unit:"kg", stockQuantity:1}), "invalid-argument");
  await expectCallableError(productSave({id:"bad-category", name:"Invalid category", category:"flower", price:1, unit:"piece", stockQuantity:1}), "invalid-argument");
  await expectCallableError(productSave({id:"bad-stock", name:"Invalid stock", category:"fruit", price:1, unit:"piece", stockQuantity:-1}), "invalid-argument");

  const enquiryResponse = await recordEnquiry({
    customerName:"Test Customer", mobile:"9999999999", fulfilment:"pickup", items:[{id:testProductIds.mango, quantity:2, price:1, lineTotal:2}], total:2
  });
  const enquiry = enquiryResponse.data;
  assert.equal(enquiry.status, "whatsapp_enquiry");
  assert.equal(enquiry.total, 360, "callable must use the saved server price, not the browser price");
  assert.equal(enquiry.items[0].unitPrice, 180);
  orderId = enquiry.enquiryId;

  await expectCallableError(orderStatus({orderId, status:"fulfilled"}), "failed-precondition");
  await orderStatus({orderId, status:"confirmed"});
  await orderStatus({orderId, status:"fulfilled"});
  await expectCallableError(orderStatus({orderId, status:"cancelled"}), "failed-precondition");

  const updatedProduct = await db.collection("products").doc(testProductIds.mango).get();
  assert.equal(updatedProduct.data().stockQuantity, 8, "fulfillment should deduct inventory once");
  const report = (await dashboard({startDate:new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date()), endDate:new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date())})).data;
  assert.equal(report.stats.actualSales, 360);
  assert.equal(report.stats.completedCount, 1);
  assert.equal(report.lowStock.some(product => product.id === testProductIds.lowStock), true);
  assert.equal(report.outOfStock.some(product => product.id === testProductIds.outOfStock), true);
  assert.equal(report.bestSelling.find(product => product.productId === testProductIds.mango).quantity, 2);
  const monthStart = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit"}).format(new Date()) + "-01";
  const monthReport = (await dashboard({startDate:monthStart, endDate:new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date())})).data;
  assert.equal(monthReport.stats.actualSales, 360, "monthly report includes today's fulfilled sale");
  await expectCallableError(dashboard({startDate:"2026-02-30", endDate:"2026-10-14"}), "invalid-argument");

  // Report date boundaries follow fulfilledAt, not the original enquiry date.
  const reportStart = Timestamp.fromDate(new Date("2026-10-10T00:00:00+05:30"));
  const reportEnd = Timestamp.fromDate(new Date("2026-10-11T00:00:00+05:30"));
  const fixtureOrders = [
    {id:`report-prior-${suffix}`.slice(0, 38), createdAt:Timestamp.fromDate(new Date("2026-10-09T16:00:00Z")), fulfilledAt:reportStart, total:111, quantity:1},
    {id:`report-inside-${suffix}`.slice(0, 38), createdAt:Timestamp.fromDate(new Date("2026-10-10T04:00:00Z")), fulfilledAt:reportEnd, total:222, quantity:2}
  ];
  for (const fixture of fixtureOrders) {
    extraOrderIds.push(fixture.id);
    await db.collection("orders").doc(fixture.id).set({
      status:"fulfilled", createdAt:fixture.createdAt, fulfilledAt:fixture.fulfilledAt,
      total:fixture.total, items:[{productId:testProductIds.mango, name:"Test mangoes", quantity:fixture.quantity, lineTotal:fixture.total}]
    });
  }
  const boundaryReport = (await dashboard({startDate:"2026-10-10", endDate:"2026-10-10"})).data;
  assert.equal(boundaryReport.stats.actualSales, 111, "fulfilled exactly at start is included, regardless of enquiry date");
  assert.equal(boundaryReport.stats.completedCount, 1);
  assert.equal(boundaryReport.bestSelling.find(item => item.productId === testProductIds.mango).quantity, 1);

  await productSave({id:testProductIds.lowStock, name:"Low test stock", category:"vegetable", price:25, unit:"bunch", stockQuantity:2, lowStockThreshold:5, seasonalAvailability:"unavailable", active:false, badge:"TEST", emoji:"🌿", color:"#e8edcf"});
  const inactive = await db.collection("products").doc(testProductIds.lowStock).get();
  const publicInactive = await db.collection("catalog").doc(testProductIds.lowStock).get();
  assert.equal(inactive.data().active, false);
  assert.equal(publicInactive.data().active, false);
  assert.equal("stockQuantity" in publicInactive.data(), false, "public catalogue must not expose exact stock");

  await adminSdkAuth.setCustomUserClaims(adminUid, {});
  await expectCallableError(dashboard({}), "permission-denied");
});

test("public WhatsApp enquiry rate limit rejects requests over the configured window", async () => {
  // The test web app supplies a synthetic App Check token through CustomProvider;
  // emulator-only debug settings skip production token-signature verification.
  let successCount = 0;
  let rateLimitError;
  const rateGuest = makeWebApp(`guest-rate-${suffix}`);
  rateAuth = rateGuest.auth;
  const rateCalls = makeFunctions(rateGuest.app);
  const rateEnquiry = httpsCallable(rateCalls, "recordWhatsAppEnquiry");
  for (let index = 0; index < 21; index++) {
    try {
      const response = await rateEnquiry({
        customerName:"Rate limit test", mobile:"9999999999", fulfilment:"pickup",
        items:[{id:testProductIds.mango, quantity:1}]
      });
      successCount++;
      extraOrderIds.push(response.data.enquiryId);
    } catch (error) {
      rateLimitError = error;
      break;
    }
  }
  assert.equal(successCount, 20, "the first 20 enquiries in the window are allowed");
  assert.equal(rateLimitError?.code, "functions/resource-exhausted");
});

test("public enquiry callable accepts an attached App Check token and rejects a missing one", async () => {
  const checked = makeWebApp(`guest-appcheck-proof-${suffix}`);
  const unchecked = makeWebApp(`no-appcheck-proof-${suffix}`);
  try {
    const checkedCall = httpsCallable(makeFunctions(checked.app), "recordWhatsAppEnquiry");
    const uncheckedCall = httpsCallable(makeFunctions(unchecked.app), "recordWhatsAppEnquiry");
    // The payload is intentionally invalid: reaching this validation response
    // proves the callable accepted the synthetic App Check token first.
    await expectCallableError(checkedCall({}), "invalid-argument");
    await expectCallableError(uncheckedCall({}), "unauthenticated");
  } finally {
    const {deleteApp} = await import("firebase/app");
    await deleteApp(checked.app).catch(() => {});
    await deleteApp(unchecked.app).catch(() => {});
  }
});
