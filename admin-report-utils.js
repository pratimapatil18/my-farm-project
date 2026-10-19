// Keep CSV generation separate so its escaping can be tested without a browser.
export function buildCsv(rows) {
  return rows.map(row => row.map(value => {
    let text = String(value ?? "");
    // Spreadsheet formula prefixes can execute when a CSV is opened.
    if (/^[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}

export function downloadCsv(filename, rows, {
  documentObject = globalThis.document,
  urlObject = globalThis.URL,
  BlobConstructor = globalThis.Blob
} = {}) {
  if (!rows.length) return false;
  const blob = new BlobConstructor(["\uFEFF", buildCsv(rows)], {type:"text/csv;charset=utf-8"});
  const url = urlObject.createObjectURL(blob);
  const anchor = documentObject.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  urlObject.revokeObjectURL(url);
  return true;
}
