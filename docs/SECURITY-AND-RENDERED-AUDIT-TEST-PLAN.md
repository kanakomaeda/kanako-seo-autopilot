# SEO Audit Security and Rendered-Page Test Plan

This checklist is a gate for adding browser rendering. It is not evidence that the checks have already passed.

## Existing initial-HTML audit regression checks

- [ ] Public HTTPS URL returns HTML and a report.
- [ ] Public HTTP URL behavior is documented and tested.
- [ ] Non-HTML content types are rejected.
- [ ] HTTP redirects are rejected; the client must submit the final URL directly.
- [ ] Responses larger than the configured HTML limit are stopped safely.
- [ ] Slow responses time out.
- [ ] Malformed URLs and unsupported schemes (file:, ftp:, javascript:) are rejected.
- [ ] URLs containing username/password credentials are rejected.
- [ ] Localhost, subdomains of localhost, .local, and .internal hosts are rejected.
- [ ] IPv4 loopback, private, link-local, multicast/reserved, and cloud metadata addresses are rejected.
- [ ] IPv6 loopback, unique-local, link-local, multicast, and IPv4-mapped private addresses are rejected.
- [ ] DNS names with any private/reserved answer are rejected, even if another answer is public.
- [ ] The HTTP socket connects to the exact address that was validated (DNS-rebinding resistance).
- [ ] Error responses do not expose stack traces, credentials, or internal network details.

## Browser-rendering feature: do not enable until all gates pass

A browser renderer executes untrusted page scripts. It must run in an isolated service or sandbox, not as an unrestricted browser process inside the public API route.

- [ ] Choose a supported renderer/runtime and verify its current hosting limits and cost.
- [ ] Browser network egress is restricted; it cannot access loopback, private, link-local, metadata, or internal service addresses.
- [ ] Every navigation, redirect, iframe, popup, image, stylesheet, script, WebSocket, and subresource request is checked against the network policy.
- [ ] DNS is revalidated at connection time; checks cannot be bypassed through redirects or DNS rebinding.
- [ ] Browser execution has strict time, memory, CPU, page-count, and response-size limits.
- [ ] Downloads, file access, persistent profiles, and unnecessary browser permissions are disabled.
- [ ] No cookies, authentication headers, environment secrets, or user credentials are forwarded to the target page.
- [ ] Browser contexts are isolated per audit and reliably destroyed after each run.
- [ ] Rate limits and abuse controls protect the audit endpoint from resource exhaustion.
- [ ] Results clearly distinguish initial HTML signals from rendered DOM signals.
- [ ] If rendering fails or times out, return the initial-HTML result and label rendered evidence unavailable; never silently treat it as a rendered audit.
- [ ] Unit tests, integration tests, build, lint, and deployment checks pass before production rollout.

## Acceptance criteria for rendered findings

- [ ] A JavaScript fixture that inserts an H1 and visible paragraph is detected after rendering.
- [ ] A fixture that adds image alt attributes is measured from the rendered DOM.
- [ ] A fixture with no JavaScript-rendered content is reported accurately.
- [ ] A fixture with a long-running script times out cleanly.
- [ ] Redirect-to-private-IP, iframe-to-private-IP, and subresource-to-private-IP attempts are blocked.
- [ ] Existing initial-HTML behavior remains available and its score is not misrepresented as a complete SEO score.

## Current status

The app currently fetches initial HTML only. None of the browser-rendering gates above should be marked complete until verified by automated tests and a deployed integration test.
