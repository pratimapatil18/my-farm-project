import assert from "node:assert/strict";
import {test} from "node:test";
import {buildCsv, downloadCsv} from "../../admin-report-utils.js";

test("CSV quotes fields, doubles embedded quotes, and protects spreadsheet formulas", () => {
  const csv = buildCsv([
    ["Name", "Total", "Note"],
    ["Mangoes", 360, "Fresh, ripe"],
    ["=HYPERLINK(\"https://bad.example\")", "-10", "Customer said \"hello\""]
  ]);
  assert.equal(csv, [
    '"Name","Total","Note"',
    '"Mangoes","360","Fresh, ripe"',
    '"\'=HYPERLINK(""https://bad.example"")","\'-10","Customer said ""hello"""'
  ].join("\r\n"));
});

test("CSV renders missing values as empty strings", () => {
  assert.equal(buildCsv([["A", null, undefined]]), '"A","",""');
});

test("CSV export creates a UTF-8 CSV blob, triggers a download, and revokes its URL", () => {
  let createdBlob;
  let clicked = false;
  let revokedUrl;
  const anchor = {click() { clicked = true; }};
  const ok = downloadCsv("inventory.csv", [["Product", "Price"], ["Mango", 180]], {
    BlobConstructor: class FakeBlob { constructor(parts, options) { this.parts = parts; this.options = options; createdBlob = this; } },
    documentObject: {createElement(tag) { assert.equal(tag, "a"); return anchor; }},
    urlObject: {
      createObjectURL(blob) { assert.equal(blob, createdBlob); return "blob:munfarm-test"; },
      revokeObjectURL(url) { revokedUrl = url; }
    }
  });
  assert.equal(ok, true);
  assert.equal(anchor.href, "blob:munfarm-test");
  assert.equal(anchor.download, "inventory.csv");
  assert.equal(clicked, true);
  assert.equal(revokedUrl, "blob:munfarm-test");
  assert.equal(createdBlob.options.type, "text/csv;charset=utf-8");
  assert.equal(createdBlob.parts[0], "\uFEFF");
  assert.match(createdBlob.parts[1], /"Mango","180"/);
});
