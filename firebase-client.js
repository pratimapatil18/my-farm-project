// Stage 1: initialize the Firebase browser SDK only.
// This module does not sign users in, read/write Firestore, or grant permissions.
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { connectAuthEmulator, getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { connectFirestoreEmulator, getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { recaptchaEnterpriseSiteKey } from "./app-check-config.js";
import { firebaseConfig } from "./firebase-config.js";

const expectedProjectId = "my-farm-project-83386";
const localHost = ["localhost", "127.0.0.1"].includes(location.hostname);
const localEmulatorMode = localHost
  && new URLSearchParams(location.search).get("emulator") === "1";
const productionHost = new Set([
  `${expectedProjectId}.web.app`,
  `${expectedProjectId}.firebaseapp.com`
]).has(location.hostname);

window.firebaseClientReady = (async () => {
  try {
    if (!localEmulatorMode && !productionHost) {
      throw new Error("Firebase access is disabled on this origin. Use localhost with ?emulator=1 for local testing, or open the production Firebase Hosting site.");
    }
    if (firebaseConfig.projectId !== expectedProjectId) {
      throw new Error("Firebase project ID does not match the configured project.");
    }

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    if (app.options.projectId !== expectedProjectId) {
      throw new Error("Initialized Firebase project ID does not match the configured project.");
    }

    let appCheck = null;
    let appCheckMode = "unconfigured";
    if (localEmulatorMode) {
      // Synthetic tokens are accepted only by the locally configured Functions
      // Emulator with its local debug flag; this never runs on a hosted site.
      const emulatorPayload = btoa(JSON.stringify({
        sub: "munfarm-local-emulator",
        app_id: app.options.appId,
        exp: Math.floor(Date.now() / 1000) + 3600
      })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      appCheck = initializeAppCheck(app, {
        provider: new CustomProvider({
          getToken: async () => ({
            token: `e30.${emulatorPayload}.local-emulator-signature`,
            expireTimeMillis: Date.now() + 60 * 60 * 1000
          })
        }),
        isTokenAutoRefreshEnabled: true
      });
      appCheckMode = "emulator";
    } else if (typeof recaptchaEnterpriseSiteKey === "string" && recaptchaEnterpriseSiteKey.trim()) {
      appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(recaptchaEnterpriseSiteKey.trim()),
        isTokenAutoRefreshEnabled: true
      });
      appCheckMode = "recaptcha-enterprise";
    }

    // These are client SDK handles only. No authentication or database operation
    // runs until a later feature explicitly uses them. App Check initializes
    // before any Firebase service is created or used.
    const auth = getAuth(app);
    const db = getFirestore(app);
    if (localEmulatorMode) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings:true});
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }

    document.documentElement.dataset.firebaseSdk = "ready";
    window.dispatchEvent(new CustomEvent("firebase-client-ready", {
      detail: { projectId: app.options.projectId, appCheckMode }
    }));
    console.info(`Firebase SDK initialized for ${app.options.projectId}; App Check mode: ${appCheckMode}.`);
    return { status: "ready", app, auth, db, appCheck, appCheckMode, localEmulatorMode };
  } catch (error) {
    document.documentElement.dataset.firebaseSdk = "error";
    console.error("Firebase SDK initialization failed.", error);
    return { status: "error", error };
  }
})();
