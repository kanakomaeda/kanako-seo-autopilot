import { NextResponse } from "next/server";
import { bearerToken, callSupabaseRpc, getAuthenticatedUser } from "@/lib/subscription-server";

export const runtime = "nodejs";

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function authorize(request: Request) {
  const token = bearerToken(request);
  if (!token) return { error: NextResponse.json({ error: "Mag-login muna para ma-access ang saved reports." }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  const user = await getAuthenticatedUser(token);
  if (!user) return { error: NextResponse.json({ error: "Nag-expire ang session. Mag-login ulit." }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  try {
    const paid = await callSupabaseRpc<boolean>("seo_has_paid_access", token, { check_user_id: user.id });
    if (!paid) return { error: NextResponse.json({
      error: "Available on Paid Plans only. Free accounts can run an SEO analysis within their usage limit, but cannot save or open reports, access Audit History, or compare progress. Upgrade to a Paid Plan to unlock these features.",
      upgradeRequired: true
    }, { status: 403, headers: { "Cache-Control": "no-store" } }) };
  } catch {
    return { error: NextResponse.json({ error: "Hindi ma-verify ang plan mo. Walang report na binago; subukan ulit mamaya." }, { status: 503, headers: { "Cache-Control": "no-store" } }) };
  }
  return { token, user };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const url = supabaseUrl(), key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Report service is not configured." }, { status: 503 });
  const response = await fetch(url + "/rest/v1/seo_saved_reports?select=id,url,final_url,score,created_at,report&order=created_at.desc&limit=100", {
    headers: { apikey: key, Authorization: "Bearer " + auth.token! }, cache: "no-store"
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return NextResponse.json({ error: "Hindi ma-load ang audit history. Subukan ulit mamaya." }, { status: response.status === 401 ? 401 : 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ reports: Array.isArray(data) ? data : [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const url = supabaseUrl(), key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Report service is not configured." }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid report payload." }, { status: 400 }); }
  if (typeof body.url !== "string" || body.url.length > 2048 || !body.report || typeof body.report !== "object") {
    return NextResponse.json({ error: "A valid audit report and URL are required." }, { status: 400 });
  }
  const reportText = JSON.stringify(body.report);
  if (reportText.length > 1_000_000) return NextResponse.json({ error: "This report is too large to save." }, { status: 413 });
  const scoreValue = (body.report as { score?: unknown }).score;
  const score = typeof scoreValue === "number" && Number.isInteger(scoreValue) && scoreValue >= 0 && scoreValue <= 100 ? scoreValue : null;
  const finalUrl = (body.report as { finalUrl?: unknown }).finalUrl;
  const response = await fetch(url + "/rest/v1/seo_saved_reports", {
    method: "POST",
    headers: { apikey: key, Authorization: "Bearer " + auth.token!, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify([{ user_id: auth.user!.id, url: body.url, final_url: typeof finalUrl === "string" ? finalUrl : null, score, report: body.report }]),
    cache: "no-store"
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return NextResponse.json({ error: "Available on Paid Plans only. Upgrade to save and revisit SEO audit reports." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "Hindi ma-save ang report. Subukan ulit mamaya." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ report: Array.isArray(data) ? data[0] : null }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "A valid report ID is required." }, { status: 400 });
  }
  const url = supabaseUrl(), key = supabaseKey();
  if (!url || !key) return NextResponse.json({ error: "Report service is not configured." }, { status: 503 });
  const response = await fetch(url + "/rest/v1/seo_saved_reports?id=eq." + encodeURIComponent(id), {
    method: "DELETE",
    headers: { apikey: key, Authorization: "Bearer " + auth.token!, Prefer: "return=minimal" }, cache: "no-store"
  });
  if (!response.ok) return NextResponse.json({ error: "Hindi ma-delete ang report." }, { status: response.status === 403 ? 403 : 503 });
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
}
