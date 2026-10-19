// Stage 1: initialize the Firebase browser SDK only.
// This module does not sign users in, read/write Firestore, or grant permissions.
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { connectAuthEmulator, getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { connectFirestoreEmulator, getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const expectedProjectId = "my-farm-project-83386";

window.firebaseClientReady = (async () => {
  try {
    if (firebaseConfig.projectId !== expectedProjectId) {
      throw new Error("Firebase project ID does not match the configured project.");
    }

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    if (app.options.projectId !== expectedProjectId) {
      throw new Error("Initialized Firebase project ID does not match the configured project.");
    }

    // These are client SDK handles only. No authentication or database operation
    // runs until a later, separately reviewed feature explicitly uses them.
    const auth = getAuth(app);
    const db = getFirestore(app);
    const localEmulatorMode = ["localhost", "127.0.0.1"].includes(location.hostname)
      && new URLSearchParams(location.search).get("emulator") === "1";
    if (localEmulatorMode) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", {disableWarnings:true});
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
    }

    document.documentElement.dataset.firebaseSdk = "ready";
    window.dispatchEvent(new CustomEvent("firebase-client-ready", {
      detail: { projectId: app.options.projectId }
    }));
    console.info(`Firebase SDK initialized for ${app.options.projectId}.`);
    return { status: "ready", app, auth, db, localEmulatorMode };
  } catch (error) {
    document.documentElement.dataset.firebaseSdk = "error";
    console.error("Firebase SDK initialization failed.", error);
    return { status: "error", error };
  }
})();
