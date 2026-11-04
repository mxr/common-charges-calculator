import { getDb, getNeonAuthBaseUrl, sendLoginCode } from "@/app/_server/services";
import { deliverOtp, hasGate, normalizeEmail } from "@/lib/server/login";
import { verifyNeonSignature } from "@/lib/server/neon-webhook";
import type { NeonAuthEvent, SigningKey } from "@/lib/server/neon-webhook";

const JWKS_REFRESH_INTERVAL_MS = 60_000;

let cachedKeys: SigningKey[] = [];
let lastFetchedAt = 0;

// Refreshes on an unknown kid at most once a minute, so forged requests cannot flood Neon.
const findKey = async (kid: string, now: Date): Promise<SigningKey | undefined> => {
  const cached = cachedKeys.find((key) => key.kid === kid);
  if (cached !== undefined || now.getTime() - lastFetchedAt < JWKS_REFRESH_INTERVAL_MS) {
    return cached;
  }
  lastFetchedAt = now.getTime();
  const response = await fetch(`${getNeonAuthBaseUrl()}/.well-known/jwks.json`, { signal: AbortSignal.timeout(3_000) });
  const { keys } = (await response.json()) as { keys: SigningKey[] };
  cachedKeys = keys;
  return keys.find((key) => key.kid === kid);
};

export const POST = async (request: Request): Promise<Response> => {
  const kid = request.headers.get("x-neon-signature-kid");
  const headers = { signature: request.headers.get("x-neon-signature"), timestamp: request.headers.get("x-neon-timestamp") };
  if (kid === null || headers.signature === null || headers.timestamp === null) {
    console.warn("Neon Auth webhook rejected: missing signature headers");
    return new Response(null, { status: 401 });
  }
  const rawBody = await request.text();
  const now = new Date();
  const key = await findKey(kid, now);
  if (key === undefined || !verifyNeonSignature(rawBody, headers, key, now)) {
    console.warn("Neon Auth webhook rejected: bad signature", { knownKey: key !== undefined });
    return new Response(null, { status: 401 });
  }

  const event = JSON.parse(rawBody) as NeonAuthEvent;
  const email = normalizeEmail(event.user.email);
  if (event.event_type === "user.before_create") {
    const allowed = await hasGate(getDb(), email, now);
    console.info("user.before_create", { allowed });
    return Response.json(allowed ? { allowed } : { allowed, error_message: "Log in from the login page.", error_code: "LOGIN_REQUIRED" });
  }

  const result = await deliverOtp(getDb(), email, () => sendLoginCode(email, event.event_data.otp_code), now);
  console.info("send.otp", { result, attempt: request.headers.get("x-neon-delivery-attempt") });
  // A blocked send also returns 200, so a caller cannot tell whether the gate passed.
  return new Response(null, { status: result === "failed" ? 500 : 200 });
};
