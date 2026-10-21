// Customer email/password authentication. Browsing and WhatsApp checkout remain
// available without signing in; customer records are not written to Firestore.
import "./firebase-client.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const form = document.querySelector("#account-form");
const backdrop = document.querySelector("#account-backdrop");
const status = document.querySelector("#auth-status");
const localHost = ["localhost", "127.0.0.1"].includes(location.hostname);
const emulatorMode = localHost && new URLSearchParams(location.search).get("emulator") === "1";
const emailInput = document.querySelector("#account-email");
const passwordInput = document.querySelector("#account-password");
const nameInput = document.querySelector("#account-name");
const nameField = document.querySelector("#account-name-field");
const accountControls = document.querySelector("#account-auth-controls");
const signedInPanel = document.querySelector("#account-signed-in");
let mode = "signin";
let auth = null;

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function describeAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "An account already uses that email. Try signing in instead.",
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/weak-password": "Choose a stronger password with at least 8 characters.",
    "auth/user-disabled": "This account is disabled. Please contact the farm.",
    "auth/missing-email": "Enter the email address for your account.",
    "auth/too-many-requests": "There have been too many attempts. Wait a while and try again.",
    "auth/network-request-failed": "Could not reach Firebase. Check your internet connection and try again.",
    "auth/operation-not-allowed": "Email/password sign-in is not enabled in Firebase Console yet.",
    "auth/unauthorized-domain": "This website domain is not authorised in Firebase Authentication settings.",
    "auth/invalid-continue-uri": "Firebase rejected the password-reset link settings. Check the authorized domains in Firebase Console.",
    "auth/unauthorized-continue-uri": "The password-reset link domain is not authorized in Firebase Console."
  };
  return messages[error?.code] || "That request could not be completed. Please try again.";
}

function logPasswordResetError(error) {
  const code = typeof error?.code === "string" && /^[a-z0-9-]+\/[a-z0-9-]+$/i.test(error.code)
    ? error.code
    : "unknown";
  const message = String(error?.message || "No error message was provided.")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL redacted]")
    .replace(/\b(password|passwd|pwd|oobCode|apiKey|email)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
  // Never pass the original Firebase error object to the console. Its message
  // may contain a URL or other request details.
  console.error("[Pratima’s Farm] Password reset failed", { code, message });
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll(".account-tab").forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  nameField.hidden = mode !== "signup";
  nameInput.required = mode === "signup";
  passwordInput.autocomplete = mode === "signup" ? "new-password" : "current-password";
  document.querySelector("#account-submit").textContent = mode === "signup" ? "Create account" : "Sign in";
  document.querySelector("#password-reset").hidden = mode === "signup";
  setStatus("");
}

function renderAuthState(user) {
  const trigger = document.querySelector("#account-trigger");
  window.firebaseCustomerProfile = user ? { name: user.displayName || "" } : null;
  trigger.textContent = user ? (user.displayName?.split(/\s+/)[0] || "Account") : "Client Login";
  accountControls.hidden = Boolean(user);
  signedInPanel.hidden = !user;
  document.querySelector("#account-user-label").textContent = user
    ? `Signed in as ${user.email || "your account"}`
    : "";
  window.dispatchEvent(new CustomEvent("firebase-customer-auth-state", {
    detail: { signedIn: Boolean(user), email: user?.email || null }
  }));
}

function showSignedIn(user) {
  if (!user) return;
  renderAuthState(user);
  backdrop.hidden = false;
}

for (const tab of document.querySelectorAll(".account-tab")) {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
}

document.querySelector("#continue-as-guest").addEventListener("click", () => {
  backdrop.hidden = true;
  setStatus("");
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!auth) {
    setStatus("Firebase is not initialized. Open the website over localhost or HTTPS and check your connection.", "error");
    return;
  }

  const submit = document.querySelector("#account-submit");
  submit.disabled = true;
  setStatus(mode === "signup" ? "Creating your account…" : "Signing you in…");
  try {
    let credential;
    if (mode === "signup") {
      credential = await createUserWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
      const name = nameInput.value.trim();
      if (name) await updateProfile(credential.user, { displayName: name });
      setStatus("Your account is ready.");
    } else {
      credential = await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
      setStatus("You are signed in.");
    }
    renderAuthState(credential.user);
    window.setTimeout(() => { backdrop.hidden = true; }, 500);
  } catch (error) {
    setStatus(describeAuthError(error), "error");
  } finally {
    submit.disabled = false;
  }
});

const resetButton = document.querySelector("#password-reset");
resetButton.addEventListener("click", async () => {
  if (!auth) {
    setStatus("Firebase is not initialized. Open the website over localhost or HTTPS and check your connection.", "error");
    return;
  }
  const email = emailInput.value.trim();
  if (!email) {
    emailInput.focus();
    setStatus("Enter your email address first, then choose Forgot password.", "error");
    return;
  }
  emailInput.value = email;
  if (!emailInput.checkValidity()) {
    emailInput.reportValidity();
    setStatus("Enter a valid email address, then try Forgot password again.", "error");
    return;
  }

  resetButton.disabled = true;
  setStatus("Sending password reset instructions…");
  try {
    console.info("[Pratima’s Farm] Calling Firebase password reset (email omitted).");
    await sendPasswordResetEmail(auth, email);
    console.info("[Pratima’s Farm] Firebase password reset request completed (email omitted).");
    setStatus("If an account uses this email, Firebase has sent a password reset link. Check your inbox and spam folder.");
  } catch (error) {
    logPasswordResetError(error);
    if (error?.code === "auth/user-not-found") {
      // Keep the same response for unknown addresses when Firebase email
      // enumeration protection is disabled, so the form does not reveal accounts.
      setStatus("If an account uses this email, Firebase has sent a password reset link. Check your inbox and spam folder.");
    } else {
      const detail = describeAuthError(error);
      setStatus(error?.code && detail === "That request could not be completed. Please try again."
        ? `Firebase could not send the reset email (${error.code}). Check Firebase Authentication settings and try again.`
        : detail, "error");
    }
  } finally {
    resetButton.disabled = false;
  }
});

document.querySelector("#account-signout").addEventListener("click", async () => {
  if (!auth) return;
  try {
    await signOut(auth);
    renderAuthState(null);
    setMode("signin");
    setStatus("You have signed out.");
  } catch (error) {
    setStatus(describeAuthError(error), "error");
  }
});

document.querySelector("#account-trigger").addEventListener("click", () => {
  if (auth?.currentUser) showSignedIn(auth.currentUser);
  else {
    renderAuthState(null);
    backdrop.hidden = false;
    setMode("signin");
  }
});

document.querySelector("#account-close").addEventListener("click", () => { backdrop.hidden = true; });
backdrop.addEventListener("click", event => { if (event.target === backdrop) backdrop.hidden = true; });
document.querySelector("#account-close").addEventListener("click", () => setStatus(""));
document.querySelector("#continue-as-guest").addEventListener("click", () => setStatus(""));

const clientResult = await window.firebaseClientReady;
setMode("signin");
if (clientResult.status === "ready") {
  auth = clientResult.auth;
  onAuthStateChanged(auth, renderAuthState, error => setStatus(describeAuthError(error), "error"));
} else {
  renderAuthState(null);
  setStatus(localHost && !emulatorMode
    ? "Local preview is not connected to production Firebase. Start the emulators and open this page with ?emulator=1 to test sign-in."
    : "Firebase did not initialize. Check the browser console and open this site over localhost or HTTPS.", "error");
}
