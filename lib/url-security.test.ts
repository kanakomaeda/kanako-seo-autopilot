import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedHostname, isBlockedIpLiteral, parsePublicHttpUrl } from "./url-security";

test("accepts normal public HTTP and HTTPS URLs", () => {
  assert.equal(parsePublicHttpUrl("https://example.com/path").hostname, "example.com");
  assert.equal(parsePublicHttpUrl("http://example.com:8080/path").port, "8080");
});

test("rejects malformed URLs and unsupported schemes", () => {
  assert.throws(() => parsePublicHttpUrl("not a URL"), /valid full URL/);
  assert.throws(() => parsePublicHttpUrl("file:///etc/passwd"), /Only HTTP and HTTPS/);
  assert.throws(() => parsePublicHttpUrl("ftp://example.com"), /Only HTTP and HTTPS/);
  assert.throws(() => parsePublicHttpUrl("javascript:alert(1)"), /Only HTTP and HTTPS/);
});

test("rejects embedded credentials", () => {
  assert.throws(() => parsePublicHttpUrl("https://user:pass@example.com"), /usernames or passwords/);
});

test("blocks localhost and internal-only hostname suffixes case-insensitively", () => {
  for (const hostname of ["localhost", "LOCALHOST.", "app.localhost", "printer.local", "service.internal"]) {
    assert.equal(isBlockedHostname(hostname), true, hostname);
    assert.throws(() => parsePublicHttpUrl("http://" + hostname), /publicly accessible/);
  }
  assert.equal(isBlockedHostname("example.com"), false);
});

test("rejects private, reserved, and malformed IP literals using strict shared validation", () => {
  for (const ip of [
    "0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
    "192.168.1.1", "100.64.0.1", "224.0.0.1", "203.0.113.1", "999.1.1.1",
    "::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "not-an-ip",
  ]) {
    assert.equal(isBlockedIpLiteral(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedIpLiteral(ip), false, ip);
  }
});
