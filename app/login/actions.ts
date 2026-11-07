"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, getDb, getEmailOtpAuth, getTurnstileSecret } from "@/app/_server/services";
import { normalizeEmail, openGate, verifyTurnstile } from "@/lib/server/login";
import type { ExpectedChallenge, GateResult } from "@/lib/server/login";

export type ActionResult = { error: string } | null;

const GATE_ERRORS: Record<Exclude<GateResult, "opened">, string> = {
  too_soon: "A code was sent less than a minute ago. Wait a moment, then try again.",
  too_many: "Too many codes were sent to this address. Try again in an hour.",
  daily_limit: "Login emails are paused for today. Try again tomorrow.",
};

const SEND_ERROR = "The code could not be sent. Try again.";

const expectedChallenge = (): ExpectedChallenge | null =>
  process.env["VERCEL_ENV"] === "production" ? { hostname: process.env["VERCEL_PROJECT_PRODUCTION_URL"] ?? "", action: "login" } : null;

export const startEmailLogin = async (rawEmail: string, token: string): Promise<ActionResult> => {
  const email = normalizeEmail(rawEmail);
  const remoteIp = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const passed = await verifyTurnstile({ token, secret: getTurnstileSecret(), remoteIp, expected: expectedChallenge(), post: fetch });
  if (!passed) {
    return { error: "The security check failed. Try again." };
  }

  const gate = await openGate(getDb(), email, new Date());
  if (gate !== "opened") {
    return { error: GATE_ERRORS[gate] };
  }

  // Neon sends codes only to existing accounts. Nobody learns this password, and the branch requires a
  // verified email before a password login, so the account can only be used through a code.
  const signUp = await getAuth().signUp.email({ email, name: email, password: randomBytes(32).toString("base64url") });
  if (signUp.error && signUp.error.code !== "USER_ALREADY_EXISTS") {
    console.error("sign-up failed", signUp.error);
    return { error: SEND_ERROR };
  }

  const { error } = await getEmailOtpAuth().emailOtp.sendVerificationOtp({ email, type: "sign-in" });
  return error ? { error: SEND_ERROR } : null;
};

export const finishEmailLogin = async (rawEmail: string, otp: string): Promise<ActionResult> => {
  const { error } = await getEmailOtpAuth().signIn.emailOtp({ email: normalizeEmail(rawEmail), otp });
  if (error) {
    return { error: "That code did not work. Check it and try again." };
  }
  redirect("/buildings");
};
