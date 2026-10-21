// Production-only, operator-run tool for the single approved farm admin account.
// Default mode is read-only. Claim changes require exact project/email flags and
// an interactive typed confirmation. Never run this in the browser or with emulator env vars.
const readline = require("node:readline/promises");
const {stdin, stdout} = require("node:process");
const {initializeApp, deleteApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");

const EXPECTED_PROJECT_ID = "my-farm-project-83386";
const EXPECTED_EMAIL = "pratimapatil18@gmail.com";
const args = process.argv.slice(2);
const grantRequested = args.includes("--grant");
const allowedArgs = new Set([
  "--grant",
  "--confirm-project=my-farm-project-83386",
  "--confirm-email=pratimapatil18@gmail.com"
]);

async function main() {
  if (args.some(arg => !allowedArgs.has(arg)) || new Set(args).size !== args.length) {
    throw new Error("Unknown or duplicate option. Run without options for a read-only lookup, or use the documented exact confirmation flags.");
  }
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Refusing to run while FIREBASE_AUTH_EMULATOR_HOST is set. Use a trusted production Cloud Shell session with no emulator variables.");
  }
  for (const envProject of [process.env.GOOGLE_CLOUD_PROJECT, process.env.GCLOUD_PROJECT]) {
    if (envProject && envProject !== EXPECTED_PROJECT_ID) {
      throw new Error("Refusing to run because the configured Google Cloud project does not match the expected production project.");
    }
  }
  if (grantRequested && (
    !args.includes(`--confirm-project=${EXPECTED_PROJECT_ID}`) ||
    !args.includes(`--confirm-email=${EXPECTED_EMAIL}`)
  )) {
    throw new Error("Grant mode requires --grant plus the exact --confirm-project and --confirm-email flags.");
  }

  const app = initializeApp({projectId: EXPECTED_PROJECT_ID});
  try {
    if (app.options.projectId !== EXPECTED_PROJECT_ID) {
      throw new Error("Firebase Admin SDK initialized for an unexpected project; refusing to continue.");
    }
    const auth = getAuth(app);
    let user;
    try {
      user = await auth.getUserByEmail(EXPECTED_EMAIL);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        console.log(`Account lookup: not found for ${EXPECTED_EMAIL} in ${EXPECTED_PROJECT_ID}. No changes made.`);
        return;
      }
      throw error;
    }

    const existingClaims = user.customClaims || {};
    const alreadyAdmin = existingClaims.admin === true;
    console.log(`Project verified: ${EXPECTED_PROJECT_ID}`);
    console.log(`Exact account found: ${EXPECTED_EMAIL}`);
    console.log(`customClaims.admin is true: ${alreadyAdmin ? "yes" : "no"}`);

    if (!grantRequested || alreadyAdmin) {
      console.log(alreadyAdmin ? "No change needed." : "Read-only lookup complete. No changes made.");
      return;
    }

    if (!stdin.isTTY) {
      throw new Error("Grant mode requires an interactive terminal for the final confirmation. No changes made.");
    }
    const rl = readline.createInterface({input:stdin, output:stdout});
    let confirmation;
    try {
      confirmation = await rl.question(`\nType GRANT ADMIN to add admin access to ${EXPECTED_EMAIL} in ${EXPECTED_PROJECT_ID}: `);
    } finally {
      rl.close();
    }
    if (confirmation !== "GRANT ADMIN") {
      console.log("Confirmation did not match. No changes made.");
      return;
    }

    // setCustomUserClaims replaces the claims object, so retain every existing claim.
    await auth.setCustomUserClaims(user.uid, {...existingClaims, admin:true});
    console.log(`Admin claim granted to ${EXPECTED_EMAIL}. Existing custom claims were preserved.`);
    console.log("The user must sign out and sign in again, or force-refresh the ID token, before the claim appears in the browser.");
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  // Firebase/Admin SDK error messages are useful for setup diagnosis; no tokens,
  // passwords, service-account fields, or full account records are printed.
  console.error("Production admin-claim tool stopped:", error.message);
  process.exitCode = 1;
});
