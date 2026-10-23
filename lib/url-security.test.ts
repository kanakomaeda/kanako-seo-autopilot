import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedHostname, isPrivateIPv4, isPrivateIPv6, parsePublicHttpUrl } from "./url-security";

test("blocks common private, loopback, link-local and reserved IPv4 ranges", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.1.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "192.88.99.1", "198.18.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPrivateIPv4(ip), true, ip);
  }
});

test("allows representative public IPv4 addresses", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34"]) assert.equal(isPrivateIPv4(ip), false, ip);
});

test("fails closed for malformed IPv4 literals", () => {
  for (const ip of ["", "1..2.3", ".1.2.3", "1.2.3.", "1.2.3.999", "01.2.3.4", "1.2.3", "1.2.3.4.5"]) {
    assert.equal(isPrivateIPv4(ip), true, ip);
  }
});

test("blocks compressed and expanded IPv6 special-use addresses", () => {
  for (const ip of [
    "::", "::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1",
    "2001:db8::1", "2001:2::1", "::2", "::ffff:127.0.0.1",
    "64:ff9b::7f00:1", "64:ff9b:1::7f00:1", "100::1", "3fff::1", "5f00::1",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:10::1", "2001:20::1", "2002:7f00:1::",
    "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
    "2001:0010:0000:0000:0000:0000:0000:0001",
    "2001:0020:0000:0000:0000:0000:0000:0001",
    "2001:0db8:0000:0000:0000:0000:0000:0001",
    "2002:7f00:0001:0000:0000:0000:0000:0001",
    "0:0:0:0:0:ffff:7f00:1",
    "::ffff:7f00:1",
  ]) {
    assert.equal(isPrivateIPv6(ip), true, ip);
  }
});

test("allows representative public IPv6 addresses", () => {
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateIPv6(ip), false, ip);
  }
});

test("fails closed for invalid IPv6 input", () => {
  for (const ip of ["", "not-an-ip", "2001:::1", "2001:db8::xyz"]) {
    assert.equal(isPrivateIPv6(ip), true, ip);
  }
});

test("blocks localhost and internal-only hostname suffixes", () => {
  for (const host of ["localhost", "printer.local", "service.internal", "app.localhost", "LOCALHOST."]) {
    assert.equal(isBlockedHostname(host), true, host);
  }
  assert.equal(isBlockedHostname("example.com"), false);
});

test("accepts only HTTP(S) URLs without embedded credentials", () => {
  assert.equal(parsePublicHttpUrl("https://example.com/path").hostname, "example.com");
  assert.throws(() => parsePublicHttpUrl("file:///etc/passwd"), /Only HTTP and HTTPS/);
  assert.throws(() => parsePublicHttpUrl("ftp://example.com"), /Only HTTP and HTTPS/);
  assert.throws(() => parsePublicHttpUrl("https://user:pass@example.com"), /usernames or passwords/);
  assert.throws(() => parsePublicHttpUrl("http://localhost"), /publicly accessible/);
  assert.throws(() => parsePublicHttpUrl("http://printer.local"), /publicly accessible/);
});
