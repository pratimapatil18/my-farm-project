import "./firebase-client.js";
import {connectFunctionsEmulator, getFunctions, httpsCallable} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";

const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const emulatorMode = local && new URLSearchParams(location.search).get("emulator") === "1";
const client = await window.firebaseClientReady;

if (client.status === "ready" && (!local || emulatorMode)) {
  const functions = getFunctions(client.app, "asia-south1");
  if (emulatorMode) connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const createEnquiry = httpsCallable(functions, "recordWhatsAppEnquiry");
  window.recordWhatsAppEnquiry = async payload => (await createEnquiry(payload)).data;
}
