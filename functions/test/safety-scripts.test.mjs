import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import {test} from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function run(script, args, env = {}) {
  return spawnSync(node, [resolve(root, script), ...args], {
    cwd: root,
    env: {...process.env, ...env},
    encoding: "utf8",
    timeout: 3000
  });
}

test("admin claim script refuses to run without explicit emulator mode", () => {
  const result = run("scripts/admin-claim.cjs", ["grant", "admin@example.test"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /emulator-only/i);
});

test("admin claim script refuses an Auth emulator host other than the local endpoint", () => {
  const result = run("scripts/admin-claim.cjs", ["grant", "admin@example.test", "--emulator"], {
    FIREBASE_AUTH_EMULATOR_HOST:"production.example:9099"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to continue/i);
});

test("catalog seed script requires explicit emulator mode and rejects a nonlocal Firestore endpoint", () => {
  const noFlag = run("scripts/seed-catalog.cjs", []);
  assert.notEqual(noFlag.status, 0);
  assert.match(noFlag.stderr, /emulator only/i);

  const wrongHost = run("scripts/seed-catalog.cjs", ["--emulator"], {
    FIRESTORE_EMULATOR_HOST:"firestore.googleapis.com:443"
  });
  assert.notEqual(wrongHost.status, 0);
  assert.match(wrongHost.stderr, /must be exactly 127\.0\.0\.1:8080/i);
});

test("Functions deployment excludes the nested project copy and keeps standard CLI exclusions", async () => {
  const config = JSON.parse(await readFile(resolve(root, "../firebase.json"), "utf8"));
  assert.deepEqual(config.functions.ignore, [
    ".git", ".runtimeconfig.json", "firebase-debug.log", "firebase-debug.*.log",
    "firestore-debug.log", "node_modules", "my-farm-project/**", "**/.git/**"
  ]);
});
