// Trusted operator script for assigning/removing the admin custom claim.
// Never copy this operation into browser code or expose service credentials.
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");

const projectId = "my-farm-project-83386";
const args = process.argv.slice(2);
const emulatorMode = args.includes("--emulator");
const [action, emailArg] = args.filter(arg => arg !== "--emulator");
const email = typeof emailArg === "string" ? emailArg.trim().toLowerCase() : "";

async function main() {
  if (!emulatorMode || args.length !== 3 || args.some(arg => arg.startsWith("-") && arg !== "--emulator")) {
    throw new Error("Admin claim changes are emulator-only. Usage: node scripts/admin-claim.cjs <grant|revoke> <admin-email> --emulator");
  }
  if (!["grant", "revoke"].includes(action) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Usage: node scripts/admin-claim.cjs <grant|revoke> <admin-email> --emulator");
  }
  const configuredHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (configuredHost && configuredHost !== "127.0.0.1:9099") {
    throw new Error("Refusing to continue because FIREBASE_AUTH_EMULATOR_HOST is not 127.0.0.1:9099.");
  }
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  initializeApp({projectId});
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const claims = {...(user.customClaims || {})};
  if (action === "grant") claims.admin = true;
  else delete claims.admin;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`Admin claim ${action === "grant" ? "granted to" : "removed from"} UID ${user.uid}. The user must refresh their ID token by signing in again.`);
}

main().catch(error => {
  console.error("Admin claim update failed:", error.message);
  process.exitCode = 1;
});
