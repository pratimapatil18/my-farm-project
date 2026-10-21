# Admin dashboard: local test and review status

## What is in this local version

- `admin.html` and `admin.js` provide a separate email/password sign-in and responsive dashboard. The backend checks the server-verified `admin: true` custom claim for every admin operation.
- `functions/index.js` contains callable backend operations. Prices and inventory used for an enquiry come from Firestore, not browser-supplied totals.
- `functions/scripts/admin-claim.cjs` is an operator-only Admin SDK tool for granting or revoking the admin claim. It is not loaded by the website.
- `products` holds full inventory; `catalog` is a public projection without exact stock counts; `orders` contains customer contact/address data.
- WhatsApp checkout still opens the existing prefilled draft. A separate function can record an explicitly unconfirmed enquiry. The website cannot confirm that a WhatsApp message was sent. Enquiries must move through `whatsapp_enquiry` → `confirmed` → `fulfilled`; only fulfilled records count as recorded sales. Payment is not verified.
- The active `firestore.rules` remains deny-all. `firestore.rules.next` is a candidate used only by the emulator configuration; it is not deployed.

## Local test status

The latest fresh Auth, Firestore and Functions Emulator Suite run completed with **15 tests passing and 0 failing**. It used isolated loopback emulator ports and the current `functions/` source plus `firestore.rules.next`. Coverage includes customer/anonymous denial of admin operations, custom-claim admin access and revocation, inventory writes and validation, catalogue privacy migration, backend-priced guest enquiries, App Check token presence/absence, rate limiting, order status transitions, stock deduction, report date boundaries, candidate Firestore rules, CSV escaping, CSV download triggering, and deployment exclusion safeguards. All requests were sent to local emulator endpoints; no production services were targeted.

The emulator used host Node.js 24 even though Functions declares Node.js 20; Firebase CLI warned about this mismatch. The suite passed, but Node.js 20 runtime compatibility was not verified in this run. The CSV download was tested in a DOM shim; the full dashboard layout and real browser download were not automated. App Check used synthetic emulator tokens with emulator verification bypass enabled, so this does not verify the production reCAPTCHA provider or live enforcement.

Local testing dependencies are installed under `functions/node_modules`; Firebase CLI is project-local. To rerun the standard emulator suite, first stop any existing emulator suite using ports 9099, 5001, and 8080, then run:

```sh
cd "$HOME/Documents/My Farm/functions"
npm run test:emulator
```

For a runtime-matched verification, install/use Node.js 20 and a macOS ARM64 JDK 21 before rerunning. The official [Firebase runtime guide](https://firebase.google.com/docs/functions/manage-functions) lists Node.js 20 and 22 as supported runtimes. Download Node.js from [nodejs.org](https://nodejs.org/en/download) and install the Apple Silicon build. For Java, use [Eclipse Adoptium Temurin](https://adoptium.net/temurin/releases/?arch=aarch64&os=mac&package=jdk&version=21), open the downloaded `.pkg`, and verify both with `node --version` and `java -version`.

## Not ready for production

1. No live administrator claim has been granted. Create the intended Firebase Authentication account, then have an authorized operator grant its claim with trusted Admin SDK credentials. Never place service-account credentials in the website or repository.
2. Candidate rules have passed emulator tests but have not been approved for production. Keep active deny-all rules until they are separately reviewed and explicitly approved.
3. `recordWhatsAppEnquiry` now declares `enforceAppCheck: true` and applies a 20-per-minute per-App-ID/IP throttle. Emulator tests cover synthetic attached/missing App Check tokens and throttling. Production behavior still requires the current Functions code to be deployed and must be verified against the registered production App Check web key/domain; emulator results are not production verification. Add monitoring and a customer-data retention review before production use.
4. No production Firebase settings, rules, billing or deployment were changed during these tests.
5. npm reported 23 advisories across the full dependency tree (11 moderate and 12 high). A production-only audit reports 8 moderate transitive advisories in Firebase Admin dependencies; npm says resolution requires a Firebase Admin SDK 14.x major upgrade. That upgrade was not applied because it needs a separate compatibility review and test run.
