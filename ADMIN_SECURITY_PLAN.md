# Admin dashboard: local test and review status

## What is in this local version

- `admin.html` and `admin.js` provide a separate email/password sign-in and responsive dashboard. The backend checks the server-verified `admin: true` custom claim for every admin operation.
- `functions/index.js` contains callable backend operations. Prices and inventory used for an enquiry come from Firestore, not browser-supplied totals.
- `functions/scripts/admin-claim.cjs` is an operator-only Admin SDK tool for granting or revoking the admin claim. It is not loaded by the website.
- `products` holds full inventory; `catalog` is a public projection without exact stock counts; `orders` contains customer contact/address data.
- WhatsApp checkout still opens the existing prefilled draft. A separate function can record an explicitly unconfirmed enquiry. The website cannot confirm that a WhatsApp message was sent. Enquiries must move through `whatsapp_enquiry` → `confirmed` → `fulfilled`; only fulfilled records count as recorded sales. Payment is not verified.
- The active `firestore.rules` remains deny-all. `firestore.rules.next` is a candidate used only by the emulator configuration; it is not deployed.

## Local test status

The Auth, Firestore and Functions Emulator Suite ran locally under the project’s declared Node 20 runtime, with **7 tests passing and 0 failing**. Coverage includes customer/anonymous denial of admin operations, custom-claim admin access, inventory writes and validation, backend-priced guest enquiries, order status transitions, stock deduction, daily/monthly reports, low/out-of-stock reporting, candidate Firestore rules, CSV escaping, and triggering a CSV download.

The CSV formatter was tested as code; the browser download click and full dashboard layout were not automated. Firebase CLI emitted non-fatal notices that the local CLI is not logged in and that unconfigured emulator services would be live if invoked. These tests called only the Auth and Firestore emulators; they did not call other services.

Local testing dependencies are installed under `functions/node_modules`; Firebase CLI is project-local. Checksum-verified Eclipse Temurin JDK 21 and Node.js 20 were unpacked to `/private/tmp/munfarm-temurin21` and `/private/tmp/munfarm-node20` for this test run and were not installed system-wide. To rerun in this same machine session:

```sh
cd "$HOME/Documents/My Farm/functions"
JAVA_HOME=/private/tmp/munfarm-temurin21/Contents/Home PATH="/private/tmp/munfarm-temurin21/Contents/Home/bin:/private/tmp/munfarm-node20/bin:$PATH" npm run test:emulator
```

If the temporary runtimes are no longer present, install Node.js 20 and a macOS ARM64 JDK 21. The official [Firebase runtime guide](https://firebase.google.com/docs/functions/manage-functions) lists Node.js 20 and 22 as supported runtimes. Download Node.js from [nodejs.org](https://nodejs.org/en/download) and install the Apple Silicon build. For Java, use [Eclipse Adoptium Temurin](https://adoptium.net/temurin/releases/?arch=aarch64&os=mac&package=jdk&version=21), open the downloaded `.pkg`, and verify both with `node --version` and `java -version`. Then run `npm run test:emulator` from the `functions` folder.

## Not ready for production

1. No live administrator claim has been granted. Create the intended Firebase Authentication account, then have an authorized operator grant its claim with trusted Admin SDK credentials. Never place service-account credentials in the website or repository.
2. Candidate rules have passed emulator tests but have not been approved for production. Keep active deny-all rules until they are separately reviewed and explicitly approved.
3. The public WhatsApp-enquiry callable is not protected by App Check or rate limiting yet. Add abuse protection, operational monitoring, and a customer-data retention review before production use.
4. No production Firebase settings, rules, billing or deployment were changed during these tests.
5. npm reported 23 advisories across the full dependency tree (11 moderate and 12 high). A production-only audit reports 8 moderate transitive advisories in Firebase Admin dependencies; npm says resolution requires a Firebase Admin SDK 14.x major upgrade. That upgrade was not applied because it needs a separate compatibility review and test run.
