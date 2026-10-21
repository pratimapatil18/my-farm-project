import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

const root = new URL("../../", import.meta.url);
const readRootFile = name => readFile(new URL(name, root), "utf8");

test("browser client initializes App Check before Firebase services", async () => {
  const source = await readRootFile("firebase-client.js");
  const appCheckAt = source.indexOf("initializeAppCheck(app");
  assert.notEqual(appCheckAt, -1, "App Check initialization is present");
  assert.ok(appCheckAt < source.indexOf("const auth = getAuth(app)"));
  assert.ok(appCheckAt < source.indexOf("const db = getFirestore(app)"));
  assert.match(source, /new ReCaptchaEnterpriseProvider\(recaptchaEnterpriseSiteKey\.trim\(\)\)/);
  assert.match(source, /isTokenAutoRefreshEnabled:\s*true/);
  assert.match(source, /if \(!localEmulatorMode && !productionHost\)/, "only explicit local emulator mode or an approved Hosting origin may initialize Firebase");
  assert.match(source, /\$\{expectedProjectId\}\.web\.app/);
  assert.match(source, /\$\{expectedProjectId\}\.firebaseapp\.com/);
  const customerAuth = await readRootFile("customer-auth.js");
  assert.match(customerAuth, /Local preview is not connected to production Firebase/);
  assert.ok(customerAuth.indexOf('setMode("signin")') < customerAuth.indexOf('if (clientResult.status === "ready")'), "local safety guidance is not cleared by initial form setup");
  const admin = await readRootFile("admin.js");
  assert.match(admin, /Local admin sign-in is disabled to protect production/);
});

test("local emulator uses a separate synthetic App Check provider instead of the production key", async () => {
  const [source, config, orderRecording, packageJson] = await Promise.all([
    readRootFile("firebase-client.js"),
    readRootFile("app-check-config.js"),
    readRootFile("order-recording.js"),
    readRootFile("functions/package.json")
  ]);
  assert.match(source, /const localEmulatorMode = localHost\s*&&\s*new URLSearchParams\(location\.search\)\.get\("emulator"\) === "1"/);
  assert.match(source, /new CustomProvider\(/);
  assert.match(source, /token:\s*`e30\.\$\{emulatorPayload\}\.local-emulator-signature`/);
  assert.match(config, /recaptchaEnterpriseSiteKey\s*=\s*["'][A-Za-z0-9_-]{30,}["']/);
  assert.match(orderRecording, /client\.status === "ready" && client\.appCheck/);
  assert.match(packageJson, /firebase\.local\.json --only auth,firestore,functions/);
  const scripts = JSON.parse(packageJson).scripts;
  assert.match(scripts.emulate, /skipTokenVerification/);
});
