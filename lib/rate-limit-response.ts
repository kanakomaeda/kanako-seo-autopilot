import { NextResponse } from "next/server";

/** Fail-closed response when the shared rate-limit service cannot be reached. */
export function rateLimitUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "The audit service is temporarily unavailable. Please try again shortly." },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": "5",
      },
    },
  );
}
