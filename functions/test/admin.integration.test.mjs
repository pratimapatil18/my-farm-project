import assert from "node:assert/strict";
import {after, before, test} from "node:test";
import {initializeApp} from "firebase/app";
import {connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword} from "firebase/auth";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "firebase/functions";
import {getAuth as getAdminAuth} from "firebase-admin/auth";
import {getFirestore as getAdminFirestore} from "firebase-admin/firestore";
import {initializeApp as initializeAdminApp} from "firebase-admin/app";

const projectId = "my-farm-project-83386";
const emulatorOrigin = "http://127.0.0.1";
const password = "FarmTest!2026";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminSdkApp;
let adminSdkAuth;
let db;
let customerAuth;
let guestAuth;
let adminWebAuth;
let customerCalls;
let guestCalls;
let adminCalls;
let productSave;
let dashboard;
let orderStatus;
let recordEnquiry;
let orderId;

function makeFunctions(app) {
  const functions = getFunctions(app, "asia-south1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  return functions;
}

function makeWebApp(name) {
  const app = initializeApp({projectId, apiKey:"emulator-test-key", appId:`1:${name}:web:test`}, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `${emulatorOrigin}:9099`, {disableWarnings:true});
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

  const admin = makeWebApp(`admin-${suffix}`);
  adminWebAuth = admin.auth;
  adminCalls = makeFunctions(admin.app);

  await createUserWithEmailAndPassword(customerAuth, `customer-${suffix}@example.test`, password);
  const adminUser = await adminSdkAuth.createUser({email:`admin-${suffix}@example.test`, password});
  await adminSdkAuth.setCustomUserClaims(adminUser.uid, {admin:true});
  await signInWithEmailAndPassword(adminWebAuth, adminUser.email, password);
});

after(async () => {
  for (const auth of [customerAuth, guestAuth, adminWebAuth]) {
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
  recordEnquiry = httpsCallable(guestCalls, "recordWhatsAppEnquiry");

  await productSave({id:"mango-test", name:"Test mangoes", category:"fruit", price:180, unit:"per kg", stockQuantity:10, lowStockThreshold:2, seasonalAvailability:"seasonal", active:true, badge:"TEST", emoji:"🥭", color:"#f5e8bd"});
  await productSave({id:"low-test", name:"Low test stock", category:"vegetable", price:25, unit:"bunch", stockQuantity:2, lowStockThreshold:5, seasonalAvailability:"year-round", active:true, badge:"TEST", emoji:"🌿", color:"#e8edcf"});
  await productSave({id:"empty-test", name:"Empty test stock", category:"fruit", price:25, unit:"piece", stockQuantity:0, lowStockThreshold:5, seasonalAvailability:"seasonal", active:true, badge:"TEST", emoji:"🍐", color:"#e8edcf"});

  await expectCallableError(productSave({id:"fraction-price", name:"Invalid price", category:"fruit", price:1.5, unit:"kg", stockQuantity:1}), "invalid-argument");
  await expectCallableError(productSave({id:"negative-price", name:"Invalid price", category:"fruit", price:-1, unit:"kg", stockQuantity:1}), "invalid-argument");
  await expectCallableError(productSave({id:"bad-category", name:"Invalid category", category:"flower", price:1, unit:"piece", stockQuantity:1}), "invalid-argument");
  await expectCallableError(productSave({id:"bad-stock", name:"Invalid stock", category:"fruit", price:1, unit:"piece", stockQuantity:-1}), "invalid-argument");

  const enquiryResponse = await recordEnquiry({
    customerName:"Test Customer", mobile:"9999999999", fulfilment:"pickup", items:[{id:"mango-test", quantity:2, price:1, lineTotal:2}], total:2
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

  const updatedProduct = await db.collection("products").doc("mango-test").get();
  assert.equal(updatedProduct.data().stockQuantity, 8, "fulfillment should deduct inventory once");
  const report = (await dashboard({startDate:new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date()), endDate:new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date())})).data;
  assert.equal(report.stats.actualSales, 360);
  assert.equal(report.stats.completedCount, 1);
  assert.equal(report.lowStock.some(product => product.id === "low-test"), true);
  assert.equal(report.outOfStock.some(product => product.id === "empty-test"), true);
  assert.equal(report.bestSelling.find(product => product.productId === "mango-test").quantity, 2);
  const monthStart = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit"}).format(new Date()) + "-01";
  const monthReport = (await dashboard({startDate:monthStart, endDate:new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Kolkata", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date())})).data;
  assert.equal(monthReport.stats.actualSales, 360, "monthly report includes today's fulfilled sale");
  await expectCallableError(dashboard({startDate:"2026-02-30", endDate:"2026-10-14"}), "invalid-argument");

  await productSave({id:"low-test", name:"Low test stock", category:"vegetable", price:25, unit:"bunch", stockQuantity:2, lowStockThreshold:5, seasonalAvailability:"unavailable", active:false, badge:"TEST", emoji:"🌿", color:"#e8edcf"});
  const inactive = await db.collection("products").doc("low-test").get();
  const publicInactive = await db.collection("catalog").doc("low-test").get();
  assert.equal(inactive.data().active, false);
  assert.equal(publicInactive.data().active, false);
  assert.equal("stockQuantity" in publicInactive.data(), false, "public catalogue must not expose exact stock");
});
