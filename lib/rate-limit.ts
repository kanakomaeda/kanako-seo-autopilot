import { createHash } from "node:crypto";

export const AUDIT_RATE_LIMIT = 10;
export const AUDIT_RATE_WINDOW_MS = 60_000;

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
local limit = tonumber(ARGV[2])
return { count <= limit and 1 or 0, math.max(0, limit - count), math.max(0, ttl) }
`;

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

type FetchLike = typeof fetch;

export async function checkAuditRateLimit(
  clientIp: string,
  options: {
    url?: string;
    token?: string;
    fetcher?: FetchLike;
    limit?: number;
    windowMs?: number;
  } = {},
): Promise<RateLimitResult> {
  const url = options.url ?? process.env.KV_REST_API_URL;
  const token = options.token ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("Rate limiter is not configured.");

  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:") throw new Error("Rate limiter endpoint must use HTTPS.");

  const key = `seo-audit:rate:${createHash("sha256").update(clientIp).digest("hex")}`;
  const response = await (options.fetcher ?? fetch)(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      "EVAL",
      RATE_LIMIT_SCRIPT,
      1,
      key,
      options.windowMs ?? AUDIT_RATE_WINDOW_MS,
      options.limit ?? AUDIT_RATE_LIMIT,
    ]),
    cache: "no-store",
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error("Rate limiter request failed.");

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("result" in payload)) {
    throw new Error("Rate limiter returned an invalid response.");
  }
  const result = (payload as { result: unknown }).result;
  if (!Array.isArray(result) || result.length < 3 ||
      !Number.isFinite(Number(result[0])) ||
      !Number.isFinite(Number(result[1])) ||
      !Number.isFinite(Number(result[2]))) {
    throw new Error("Rate limiter returned an invalid result.");
  }

  if (Number(result[0]) === 1) {
    return { allowed: true, remaining: Math.max(0, Number(result[1])) };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(Number(result[2]) / 1000)),
  };
}
