import { and, desc, eq, gt, lt } from "drizzle-orm";
import { otpGate, otpSend } from "./schema";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type Db = PgDatabase<PgQueryResultHKT>;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;
const MAX_TOKEN_LENGTH = 2048;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const GATE_TTL_MS = 5 * MINUTE_MS;
const MIN_SEND_INTERVAL_MS = MINUTE_MS;
const MAX_SENDS_PER_ADDRESS_PER_HOUR = 5;
// Below Gmail's consumer limit, so an attack cannot use up the quota silently.
const MAX_SENDS_PER_DAY = 300;

export type ExpectedChallenge = { hostname: string; action: string };

export type TurnstileRequest = {
  token: string;
  secret: string;
  remoteIp: string | null;
  // Null skips the checks, because Cloudflare's test keys report neither value.
  expected: ExpectedChallenge | null;
  post: typeof fetch;
};

type SiteverifyResponse = { success: boolean; hostname?: string; action?: string };

export const verifyTurnstile = async ({ token, secret, remoteIp, expected, post }: TurnstileRequest): Promise<boolean> => {
  if (token === "" || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null) {
    body.set("remoteip", remoteIp);
  }
  const response = await post(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS) });
  const result = (await response.json()) as SiteverifyResponse;
  if (!result.success) {
    return false;
  }
  return expected === null || (result.hostname === expected.hostname && result.action === expected.action);
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export type GateResult = "opened" | "too_soon" | "too_many" | "daily_limit";

export const openGate = async (db: Db, email: string, now: Date): Promise<GateResult> => {
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const recent = await db
    .select({ sentAt: otpSend.sentAt })
    .from(otpSend)
    .where(and(eq(otpSend.email, email), gt(otpSend.sentAt, hourAgo)))
    .orderBy(desc(otpSend.sentAt));
  const [latest] = recent;
  if (latest !== undefined && now.getTime() - latest.sentAt.getTime() < MIN_SEND_INTERVAL_MS) {
    return "too_soon";
  }
  if (recent.length >= MAX_SENDS_PER_ADDRESS_PER_HOUR) {
    return "too_many";
  }
  const sentToday = await db.$count(otpSend, gt(otpSend.sentAt, new Date(now.getTime() - DAY_MS)));
  if (sentToday >= MAX_SENDS_PER_DAY) {
    return "daily_limit";
  }
  await writeGate(db, email, now);
  return "opened";
};

const writeGate = async (db: Db, email: string, now: Date): Promise<void> => {
  const expiresAt = new Date(now.getTime() + GATE_TTL_MS);
  await db.insert(otpGate).values({ email, expiresAt }).onConflictDoUpdate({ target: otpGate.email, set: { expiresAt } });
};

const consumeGate = async (db: Db, email: string, now: Date): Promise<boolean> => {
  const deleted = await db
    .delete(otpGate)
    .where(and(eq(otpGate.email, email), gt(otpGate.expiresAt, now)))
    .returning({ email: otpGate.email });
  return deleted.length > 0;
};

// Neon sends codes only to existing accounts, so the login action creates the account first. This check
// stops anyone from creating an account without passing Turnstile.
export const hasGate = async (db: Db, email: string, now: Date): Promise<boolean> =>
  (await db.$count(otpGate, and(eq(otpGate.email, email), gt(otpGate.expiresAt, now)))) > 0;

export type SendOtpResult = "sent" | "blocked" | "failed";

// A code is delivered only while a gate row exists, and each row delivers one code. A failed send
// restores the row, so Neon's retry can deliver the code.
export const deliverOtp = async (db: Db, email: string, send: () => Promise<void>, now: Date): Promise<SendOtpResult> => {
  if (!(await consumeGate(db, email, now))) {
    return "blocked";
  }
  try {
    await send();
  } catch {
    await writeGate(db, email, now);
    return "failed";
  }
  await db.insert(otpSend).values({ email, sentAt: now });
  await db.delete(otpSend).where(lt(otpSend.sentAt, new Date(now.getTime() - DAY_MS)));
  return "sent";
};
