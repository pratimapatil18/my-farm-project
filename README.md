# Pratima’s Farm website

This is the existing farm shop website. To preview the customer pages locally, open a Terminal window, go to this folder, and start a local web server:

```sh
cd "$HOME/Documents/My Farm"
python3 -m http.server 8000
```

Then open `http://localhost:8000/` in a browser. Press Control+C in Terminal to stop the server. The site can also be opened as a file, but local HTTP is needed for Firebase modules.

## Firebase and admin dashboard status

The Firebase web configuration is in `firebase-config.js`. The current `firestore.rules` intentionally denies all Firestore client access. The proposed admin rules are in `firestore.rules.next`; they are only a review candidate and are not deployed.

The admin page is `admin.html`. Admin permissions are checked by Cloud Functions using a Firebase Authentication custom claim assigned by a trusted operator. No account can grant itself the admin role from the browser. Do not place service-account credentials in this folder or in browser JavaScript.

The Auth, Firestore and Functions Emulator Suite has passed seven local tests. See `ADMIN_SECURITY_PLAN.md` for exact coverage, rerun instructions and remaining production requirements. The test-only Firebase CLI and dependencies are in `functions/node_modules`; the site does not load these packages.

WhatsApp checkout opens the existing prefilled message to the farm’s receiving number. The website cannot detect whether the customer sends that message. A backend enquiry is explicitly unconfirmed, and only an administrator-verified fulfilled record appears in recorded sales. Payment is not verified by the website.
