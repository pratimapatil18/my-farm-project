import "./firebase-client.js";
import {collection, getDocs} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const emulatorMode = local && new URLSearchParams(location.search).get("emulator") === "1";
const client = await window.firebaseClientReady;

// Never let local checkout tests read or alter production inventory. On the
// published site this reads only active catalogue documents allowed by rules.
if (client.status === "ready" && (!local || emulatorMode)) {
  try {
    const snapshot = await getDocs(collection(client.db, "catalog"));
    const products = snapshot.docs.map(document => ({...document.data(), id:document.id}));
    window.munfarmCatalogProducts = products;
    window.dispatchEvent(new CustomEvent("munfarm-catalog-ready", {detail:{products}}));
  } catch (error) {
    // The existing in-file catalogue remains available while the replacement
    // rules are not active or while the backend is not configured.
    console.info("Farm catalogue is using the website's existing local data until Firebase catalogue access is configured.", error?.code || "unavailable");
  }
}
