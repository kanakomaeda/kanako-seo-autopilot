import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateIPv4, isPrivateIPv6 } from "./ip-validation";

test("IPv6 validation allows a public global-unicast address", () => {
  assert.equal(isPrivateIPv6("2606:4700:4700::1111"), false);
});

test("IPv6 validation blocks non-global and special-purpose ranges", () => {
  for (const ip of [
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1",
    "ff02::1", "2001:db8::1", "2001::1", "2002::1",
  ]) {
    assert.equal(isPrivateIPv6(ip), true, ip);
  }
});

test("IPv4-mapped IPv6 addresses use the IPv4 reserved-range checks", () => {
  for (const ip of [
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.1.1",
    "::ffff:192.168.1.1",
  ]) {
    assert.equal(isPrivateIPv6(ip), true, ip);
  }
  assert.equal(isPrivateIPv6("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateIPv6("::ffff:808:808"), false);
});

test("IPv4 validation blocks private, loopback, link-local and reserved ranges", () => {
  for (const ip of [
    "0.1.2.3", "10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
    "192.168.1.1", "100.64.0.1", "224.0.0.1", "203.0.113.1",
  ]) {
    assert.equal(isPrivateIPv4(ip), true, ip);
  }
  assert.equal(isPrivateIPv4("8.8.8.8"), false);
  assert.equal(isPrivateIPv4("1.1.1.1"), false);
});

test("malformed IP inputs are never treated as safe", () => {
  assert.equal(isPrivateIPv4("999.1.1.1"), true);
  assert.equal(isPrivateIPv6("not-an-ip"), true);
});
