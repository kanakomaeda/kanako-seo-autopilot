# Audit endpoint rate limiting

The public `POST /api/audit` endpoint uses Upstash Redis for a shared, atomic per-IP limit.

## Environment variables

Configure these in Vercel for Preview and Production:

- `KV_REST_API_URL`: Upstash HTTPS REST endpoint
- `KV_REST_API_TOKEN`: Upstash REST token with write access

Never expose these values to browser code or commit them to the repository. The endpoint fails closed with HTTP 503 when Redis is missing or unavailable; it does not silently bypass the limit.

## Default policy

- 10 audit requests per IP per 60-second Redis window.
- HTTP 429 when the limit is exceeded, with `Retry-After` and `Cache-Control: no-store`.
- HTTP 503 when the limiter is unavailable, so an infrastructure failure cannot disable abuse protection.
- IP addresses are SHA-256 hashed before being used as Redis key material. URLs and IP addresses are not logged by this limiter.

The counter is incremented atomically in Redis, so multiple serverless instances share the same limit. Tune the limit after reviewing real usage and abuse patterns.
