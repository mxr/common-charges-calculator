import { createPublicKey, verify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

const MAX_TIMESTAMP_AGE_MS = 5 * 60_000;

export type SigningKey = JsonWebKey & { kid: string };

export type SignatureHeaders = { signature: string | null; timestamp: string | null };

export type NeonAuthEvent =
  | { event_type: "send.otp"; user: { email: string }; event_data: { otp_code: string } }
  | { event_type: "user.before_create"; user: { email: string } };

// Neon signs a detached Ed25519 JWS over the timestamp and the raw body.
export const verifyNeonSignature = (rawBody: string, headers: SignatureHeaders, key: SigningKey, now: Date): boolean => {
  const { signature, timestamp } = headers;
  if (signature === null || timestamp === null) {
    return false;
  }
  if (Math.abs(now.getTime() - Number(timestamp)) > MAX_TIMESTAMP_AGE_MS) {
    return false;
  }
  const [protectedHeader, payload, signaturePart] = signature.split(".");
  if (payload !== "" || signaturePart === undefined) {
    return false;
  }
  const encodedBody = Buffer.from(rawBody, "utf8").toString("base64url");
  const signedPayload = Buffer.from(`${timestamp}.${encodedBody}`, "utf8").toString("base64url");
  const signingInput = Buffer.from(`${protectedHeader}.${signedPayload}`, "utf8");
  const publicKey = createPublicKey({ key, format: "jwk" });
  return verify(null, signingInput, publicKey, Buffer.from(signaturePart, "base64url"));
};
