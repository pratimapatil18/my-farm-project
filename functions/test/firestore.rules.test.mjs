import {readFile} from "node:fs/promises";
import {after, before, beforeEach, test} from "node:test";
import assert from "node:assert/strict";
import {initializeTestEnvironment, assertFails, assertSucceeds} from "@firebase/rules-unit-testing";
import {collection, doc, getDoc, getDocs, query, setDoc, where} from "firebase/firestore";

// Keep destructive clearFirestore() setup isolated from the local farm project
// data when these tests run against an already-started Firestore emulator.
const projectId = "my-farm-project-83386-rules-tests";
let testEnv;

before(async () => {
  const rules = await readFile(new URL("../../firestore.rules.next", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {rules}
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, "products", "mango"), {name: "Mangoes", active: true, price: 180});
    await setDoc(doc(db, "products", "hidden-fruit"), {name: "Hidden fruit", active: false, price: 20});
    await setDoc(doc(db, "catalog", "mango"), {name: "Mangoes", active: true, price: 180, inStock: true});
    await setDoc(doc(db, "catalog", "hidden-fruit"), {name: "Hidden fruit", active: false, price: 20, inStock: false});
    await setDoc(doc(db, "orders", "order-1234567890123456"), {status: "whatsapp_enquiry", customer: {name: "Private buyer"}});
  });
});

after(async () => {
  await testEnv?.cleanup();
});

test("guests can read the public catalog projection, which omits exact stock", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  const activeQuery = query(collection(db, "catalog"), where("active", "==", true));
  await assertSucceeds(getDocs(activeQuery));
  await assertSucceeds(getDoc(doc(db, "catalog", "hidden-fruit")));
  await assertFails(getDoc(doc(db, "products", "mango")));
  await assertFails(getDoc(doc(db, "orders", "order-1234567890123456")));
});

test("a normal customer cannot read orders or write product/order data", async () => {
  const db = testEnv.authenticatedContext("customer-uid", {admin: false}).firestore();
  await assertFails(getDoc(doc(db, "orders", "order-1234567890123456")));
  await assertFails(getDoc(doc(db, "products", "mango")));
  await assertFails(setDoc(doc(db, "products", "mango"), {name: "Fake price", active: true, price: 1}));
  await assertFails(setDoc(doc(db, "orders", "customer-created-order"), {customer: {name: "No"}}));
});

test("an admin claim grants read access, but all client writes remain blocked", async () => {
  const db = testEnv.authenticatedContext("admin-uid", {admin: true}).firestore();
  await assertSucceeds(getDoc(doc(db, "orders", "order-1234567890123456")));
  await assertSucceeds(getDoc(doc(db, "products", "hidden-fruit")));
  await assertFails(setDoc(doc(db, "products", "mango"), {name: "Client write", active: true, price: 1}));
});
