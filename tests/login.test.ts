import { generateKeyPairSync, sign } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { deliverOtp, hasGate, normalizeEmail, openGate, verifyTurnstile } from "../lib/server/login";
import { verifyNeonSignature } from "../lib/server/neon-webhook";
import { otpGate, otpSend } from "../lib/server/schema";
import type { Db, ExpectedChallenge } from "../lib/server/login";
import type { SigningKey } from "../lib/server/neon-webhook";

const EMAIL = "person@example.org";
const NOW = new Date("2026-11-01T12:00:00Z");
const minutesAfter = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("verifyTurnstile", () => {
  const verify = (token: string, reply: object, expected: ExpectedChallenge | null, remoteIp: string | null = null) => {
    const bodies: URLSearchParams[] = [];
    const post = (async (_url: string, init: RequestInit) => {
      bodies.push(init.body as URLSearchParams);
      return Response.json(reply);
    }) as typeof fetch;
    return { bodies, result: verifyTurnstile({ token, secret: "secret", remoteIp, expected, post }) };
  };
  const expected = { hostname: "app.example.org", action: "login" };

  it.each([
    { name: "any passing reply when nothing is expected", reply: { success: true }, want: null, passes: true },
    { name: "a matching hostname and action", reply: { success: true, ...expected }, want: expected, passes: true },
    { name: "a failed challenge", reply: { success: false, ...expected }, want: expected, passes: false },
    { name: "the wrong hostname", reply: { success: true, ...expected, hostname: "evil.example" }, want: expected, passes: false },
    { name: "the wrong action", reply: { success: true, ...expected, action: "other" }, want: expected, passes: false },
  ])("checks $name", async ({ reply, want, passes }) => {
    expect(await verify("token", reply, want).result).toBe(passes);
  });

  it.each(["", "x".repeat(2049)])("refuses a bad token without calling Cloudflare", async (token) => {
    const { bodies, result } = verify(token, { success: true }, null);
    expect(await result).toBe(false);
    expect(bodies).toEqual([]);
  });

  it("sends the visitor's IP when it is known", async () => {
    const { bodies, result } = verify("token", { success: true }, null, "198.51.100.7");
    await result;
    expect(bodies[0]?.get("remoteip")).toBe("198.51.100.7");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Person@Example.ORG ")).toBe(EMAIL);
  });
});

describe("login gate", () => {
  let db: Db;
  const sent: string[] = [];
  const send = async () => {
    sent.push(EMAIL);
  };
  const seedSends = (email: string, sentAt: Date, count = 1) =>
    db.insert(otpSend).values(Array.from({ length: count }, () => ({ email, sentAt })));

  beforeEach(async () => {
    sent.length = 0;
    const pglite = drizzle(new PGlite());
    await migrate(pglite, { migrationsFolder: "drizzle" });
    db = pglite as unknown as Db;
  });

  it("drops a code when no gate exists, as with a direct call to Neon", async () => {
    expect(await deliverOtp(db, EMAIL, send, NOW)).toBe("blocked");
    expect(sent).toEqual([]);
  });

  it("delivers one code for each gate", async () => {
    expect(await openGate(db, EMAIL, NOW)).toBe("opened");
    expect(await deliverOtp(db, EMAIL, send, NOW)).toBe("sent");
    expect(await deliverOtp(db, EMAIL, send, NOW)).toBe("blocked");
    expect(sent).toEqual([EMAIL]);
    expect(await db.$count(otpSend)).toBe(1);
  });

  it("drops a code after the gate expires", async () => {
    await openGate(db, EMAIL, NOW);
    expect(await deliverOtp(db, EMAIL, send, minutesAfter(6))).toBe("blocked");
  });

  it("restores the gate when Gmail fails, so Neon's retry can send the code", async () => {
    await openGate(db, EMAIL, NOW);
    const failing = async () => {
      throw new Error("smtp down");
    };
    expect(await deliverOtp(db, EMAIL, failing, NOW)).toBe("failed");
    expect(await db.$count(otpSend)).toBe(0);
    expect(await deliverOtp(db, EMAIL, send, NOW)).toBe("sent");
  });

  it("allows account creation only while a gate is open, without using it up", async () => {
    expect(await hasGate(db, EMAIL, NOW)).toBe(false);
    await openGate(db, EMAIL, NOW);
    expect(await hasGate(db, EMAIL, NOW)).toBe(true);
    expect(await hasGate(db, "other@example.org", NOW)).toBe(false);
    expect(await hasGate(db, EMAIL, minutesAfter(6))).toBe(false);
    expect(await deliverOtp(db, EMAIL, send, NOW)).toBe("sent");
  });

  it("refreshes an existing gate", async () => {
    await openGate(db, EMAIL, NOW);
    await openGate(db, EMAIL, minutesAfter(4));
    expect(await db.$count(otpGate)).toBe(1);
    expect(await deliverOtp(db, EMAIL, send, minutesAfter(8))).toBe("sent");
  });

  it("limits one email a minute for each address", async () => {
    await seedSends(EMAIL, NOW);
    expect(await openGate(db, EMAIL, minutesAfter(0.5))).toBe("too_soon");
    expect(await openGate(db, EMAIL, minutesAfter(2))).toBe("opened");
    expect(await openGate(db, "other@example.org", minutesAfter(0.5))).toBe("opened");
  });

  it("limits five emails an hour for each address", async () => {
    await seedSends(EMAIL, NOW, 5);
    expect(await openGate(db, EMAIL, minutesAfter(30))).toBe("too_many");
    expect(await openGate(db, EMAIL, minutesAfter(61))).toBe("opened");
  });

  it("stops all emails at the daily limit", async () => {
    await seedSends("other@example.org", minutesAfter(-120), 300);
    expect(await openGate(db, EMAIL, NOW)).toBe("daily_limit");
    expect(await openGate(db, EMAIL, minutesAfter(24 * 60))).toBe("opened");
  });

  it("removes send records older than a day", async () => {
    await seedSends("other@example.org", minutesAfter(-25 * 60));
    await openGate(db, EMAIL, NOW);
    await deliverOtp(db, EMAIL, send, NOW);
    expect(await db.$count(otpSend)).toBe(1);
  });
});

describe("verifyNeonSignature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key: SigningKey = { ...publicKey.export({ format: "jwk" }), kid: "key-1" };
  const body = '{"event_type":"send.otp"}';
  const timestamp = String(NOW.getTime());

  const signature = (signedBody: string, signedTimestamp: string) => {
    const header = Buffer.from('{"alg":"EdDSA"}').toString("base64url");
    const encodedBody = Buffer.from(signedBody).toString("base64url");
    const payload = Buffer.from(`${signedTimestamp}.${encodedBody}`).toString("base64url");
    return `${header}..${sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
  };

  it("accepts a correct signature", () => {
    expect(verifyNeonSignature(body, { signature: signature(body, timestamp), timestamp }, key, NOW)).toBe(true);
  });

  it.each([
    { name: "a missing signature", headers: { signature: null, timestamp } },
    { name: "a missing timestamp", headers: { signature: signature(body, timestamp), timestamp: null } },
    { name: "a changed body", headers: { signature: signature("{}", timestamp), timestamp } },
    { name: "a changed timestamp", headers: { signature: signature(body, "1"), timestamp } },
    { name: "an attached payload", headers: { signature: "a.b.c", timestamp } },
    { name: "a truncated signature", headers: { signature: "a.", timestamp: timestamp } },
    { name: "no separators", headers: { signature: "abc", timestamp } },
  ])("rejects $name", ({ headers }) => {
    expect(verifyNeonSignature(body, headers, key, NOW)).toBe(false);
  });

  it("rejects a timestamp older than 5 minutes", () => {
    const stale = String(minutesAfter(-6).getTime());
    expect(verifyNeonSignature(body, { signature: signature(body, stale), timestamp: stale }, key, NOW)).toBe(false);
  });
});
