import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHtml, scoreFindings, type Finding } from "./audit";
const finding = (severity: Finding["severity"]): Finding => ({ id: severity, title: severity, severity, detail: "", recommendation: "" });
test("informational findings do not reduce score", () => { assert.equal(scoreFindings([finding("info")]), 100); });
test("warnings and critical findings affect the score", () => { assert.equal(scoreFindings([finding("warning"), finding("critical")]), 84); });
test("flags a JavaScript-heavy shell and lowers evidence coverage", () => {
 const result = analyzeHtml('<html><head><title>App</title></head><body><div id="root"></div><script src="/one.js"></script><script src="/two.js"></script></body></html>');
 assert.equal(result.limitedEvidence, true); assert.ok(result.findings.some(f => f.id === "js-shell")); assert.ok(result.coverage < 100);
});
test("missing structured data alone is informational", () => {
 const result = analyzeHtml('<html lang="en"><head><title>A clear descriptive page title</title><meta name="viewport" content="width=device-width"></head><body><h1>Hello</h1><p>' + "Useful content ".repeat(30) + '</p></body></html>');
 assert.ok(result.findings.some(f => f.id === "structured-data" && f.severity === "info")); assert.equal(result.score, 100);
});
