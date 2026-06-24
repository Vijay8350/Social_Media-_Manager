import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export const runtime = "nodejs";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://social.apanjob.com";

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Verify and decode Facebook's signed_request (HMAC-SHA256 with the app secret). */
function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): { user_id?: string } | null {
  const [encodedSig, payload] = signedRequest.split(".");
  if (!encodedSig || !payload) return null;
  const sig = base64UrlDecode(encodedSig);
  const expected = createHmac("sha256", appSecret).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Health/reachability response for GET (browsers and Meta's URL check). The real
 * work happens on POST; without this, a GET returns 405 and looks "broken".
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "facebook_data_deletion_callback",
    info: `POST a Facebook signed_request here, or see ${appUrl}/data-deletion`,
  });
}

/**
 * Facebook Data Deletion Request callback.
 * Facebook POSTs `signed_request` (form-encoded). We verify it, log the request,
 * and return JSON { url, confirmation_code } pointing at our status page.
 * https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export async function POST(request: NextRequest) {
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json(
      { error: "data deletion not configured" },
      { status: 500 },
    );
  }

  let signedRequest: string | null = null;
  try {
    const form = await request.formData();
    const v = form.get("signed_request");
    signedRequest = typeof v === "string" ? v : null;
  } catch {
    signedRequest = null;
  }

  if (!signedRequest) {
    return NextResponse.json({ error: "missing signed_request" }, { status: 400 });
  }

  const data = parseSignedRequest(signedRequest, appSecret);
  if (!data) {
    return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });
  }

  const confirmationCode = randomBytes(8).toString("hex");

  // Best-effort: record the request so it can be actioned within 30 days.
  // Never let logging failure break the callback response Facebook expects.
  try {
    const { createServiceRoleClient } = await import("@insta/shared");
    const svc = createServiceRoleClient();
    await svc.from("jobs_log").insert({
      stage: "data_deletion",
      level: "info",
      message: "Facebook data deletion request received",
      context: { fb_user_id: data.user_id ?? null, confirmation_code: confirmationCode },
    });
  } catch {
    // service role not configured here, or insert failed — proceed anyway.
  }

  return NextResponse.json({
    url: `${appUrl}/data-deletion?id=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
