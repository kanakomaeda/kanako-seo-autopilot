import { NextResponse } from "next/server";
import { checkAuditRateLimit, type RateLimitResult } from "./rate-limit";

export function rateLimitUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "The audit service is temporarily unavailable. Please try again shortly." },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } },
  );
}

export function rateLimitExceededResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: "Too many audit requests. Please wait before trying again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": "10",
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}

/** Runs the rate-limit check and converts service failures/denials into safe HTTP responses. */
export async function enforceAuditRateLimit(
  clientIp: string,
  check: (ip: string) => Promise<RateLimitResult> = checkAuditRateLimit,
): Promise<{ result: RateLimitResult; response?: never } | { result?: never; response: NextResponse }> {
  try {
    const result = await check(clientIp);
    if (!result.allowed) return { response: rateLimitExceededResponse(result.retryAfterSeconds) };
    return { result };
  } catch {
    return { response: rateLimitUnavailableResponse() };
  }
}
