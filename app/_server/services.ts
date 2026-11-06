import { createNeonAuth } from "@neon/auth/next/server";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWebSocket } from "drizzle-orm/neon-serverless";
import { redirect } from "next/navigation";
import nodemailer from "nodemailer";
import type { Db } from "@/lib/server/login";

// These are created on first use, because production builds run without the sensitive variables.
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
};

const once = <T>(create: () => T): (() => T) => {
  let value: T | undefined;
  return () => {
    value ??= create();
    return value;
  };
};

export const getAuth = once(() =>
  createNeonAuth({
    baseUrl: requireEnv("NEON_AUTH_BASE_URL"),
    cookies: { secret: requireEnv("NEON_AUTH_COOKIE_SECRET") },
  }),
);

// The server API has these methods at runtime, but its types leave them out.
type EmailOtpApi = {
  emailOtp: { sendVerificationOtp: (input: { email: string; type: "sign-in" }) => Promise<{ error: unknown }> };
  signIn: { emailOtp: (input: { email: string; otp: string }) => Promise<{ error: unknown }> };
  signUp: { email: (input: { email: string; name: string; password: string }) => Promise<{ error: { code?: string } | null }> };
};

export const getEmailOtpAuth = (): EmailOtpApi => getAuth() as unknown as EmailOtpApi;

export const getDb = once((): Db => drizzle(requireEnv("DATABASE_URL")));

// neon-http has no transactions, so a transaction runs over a WebSocket Pool. The socket must not outlive the request,
// so each call opens its own Pool and closes it.
export const withTransactions = async <T>(use: (db: Db) => Promise<T>): Promise<T> => {
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
  try {
    return await use(drizzleWebSocket({ client: pool }));
  } finally {
    await pool.end();
  }
};

const getMailer = once(() =>
  nodemailer.createTransport({
    service: "gmail",
    // Google shows app passwords in groups of four, so a pasted value can contain spaces.
    auth: { user: requireEnv("GMAIL_USER"), pass: requireEnv("GMAIL_APP_PASSWORD").replaceAll(" ", "") },
    connectionTimeout: 4_000,
    greetingTimeout: 4_000,
    socketTimeout: 5_000,
  }),
);

export const sendLoginCode = async (email: string, code: string): Promise<void> => {
  await getMailer().sendMail({
    from: `Common Charges Calculator <${requireEnv("GMAIL_USER")}>`,
    to: email,
    subject: `${code} is your login code`,
    text: `Your Common Charges Calculator login code is ${code}.\n\nIf you did not ask for it, ignore this email.`,
  });
};

export const getSiteKey = (): string => requireEnv("CLOUDFLARE_TURNSTILE_SITE_KEY");

export const getTurnstileSecret = (): string => requireEnv("CLOUDFLARE_TURNSTILE_SECRET_KEY");

export const getNeonAuthBaseUrl = (): string => requireEnv("NEON_AUTH_BASE_URL");

// Pages and Server Actions call this first. The proxy also redirects, but a Server Action can be called directly.
export const requireUser = async (): Promise<{ id: string; email: string }> => {
  const { data: session } = await getAuth().getSession();
  if (!session?.user) {
    redirect("/login");
  }
  return session.user;
};
