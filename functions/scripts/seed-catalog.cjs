// One-time bootstrap: copies the existing storefront products into Firestore
// with unknown stock quantities. It uses the site's current script.js as its
// source, so existing names, images, units and prices are not retyped here.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {initializeApp} = require("firebase-admin/app");
const {FieldValue, getFirestore} = require("firebase-admin/firestore");

const projectId = "my-farm-project-83386";
const sourcePath = path.resolve(__dirname, "../../script.js");
const source = fs.readFileSync(sourcePath, "utf8");
const seedArgs = process.argv.slice(2);
if (seedArgs.length !== 1 || seedArgs[0] !== "--emulator") {
  throw new Error("Live catalog seeding is disabled in this project script. Use the Firestore emulator only.");
}
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080") {
  throw new Error("Refusing to seed: FIRESTORE_EMULATOR_HOST must be exactly 127.0.0.1:8080.");
}
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const declaration = source.match(/(?:const|let)\s+products\s*=\s*\[/);
const start = declaration ? declaration.index : -1;
const end = source.indexOf("\n];", start);
if (start < 0 || end < 0) throw new Error("Could not find the existing product list in script.js; no data was written.");
const literal = source.slice(start + declaration[0].indexOf("["), end + 2);
const sandbox = Object.create(null);
vm.runInNewContext(`globalThis.catalog = ${literal}`, sandbox, {timeout: 1000});
if (!Array.isArray(sandbox.catalog) || sandbox.catalog.length < 1) throw new Error("The product list could not be read; no data was written.");

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    console.warn("This uses Application Default Credentials. Run gcloud auth application-default login first, or point to the local emulator.");
  }
  initializeApp({projectId});
  const db = getFirestore();
  const batch = db.batch();
  batch.set(db.collection("system").doc("publicCatalog"), {
    ready: false,
    updatedAt: FieldValue.serverTimestamp()
  });
  for (const product of sandbox.catalog) {
    const availability = /SEASONAL|IN SEASON/i.test(product.badge) ? "seasonal" : "year-round";
    const record = {
      ...product,
      active: true,
      stockQuantity: null,
      lowStockThreshold: 5,
      seasonalAvailability: availability,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    batch.set(db.collection("products").doc(product.id), record);
    const {stockQuantity, lowStockThreshold, createdAt, ...publicFields} = record;
    batch.set(db.collection("catalog").doc(product.id), {
      name: publicFields.name,
      category: publicFields.category,
      price: publicFields.price,
      unit: publicFields.unit,
      emoji: publicFields.emoji,
      image: publicFields.image || "",
      imageAlt: publicFields.imageAlt || "",
      imageSource: publicFields.imageSource || "farm",
      color: publicFields.color || "#e8edcf",
      badge: publicFields.badge || "SEASONAL",
      active: true,
      inStock: true,
      seasonalAvailability: availability,
      updatedAt: FieldValue.serverTimestamp()
    });
  }
  await batch.commit();
  console.log(`Seeded ${sandbox.catalog.length} existing products. Stock is marked unknown until the admin counts it.`);
}

main().catch(error => {
  console.error("Catalog seed failed:", error.message);
  process.exitCode = 1;
});
