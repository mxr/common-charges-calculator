"use client";

import Script from "next/script";
import { useRef, useState } from "react";
import { finishEmailLogin, startEmailLogin } from "./actions";
import type { FormEvent } from "react";

type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string; action: string; callback: (token: string) => void }) => string;
  reset: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const INPUT_CLASS = "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm";
const BUTTON_CLASS = "rounded-xl bg-[#1a1b1f] px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

export const LoginForm = ({ siteKey }: { siteKey: string }) => {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const widgetElement = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const renderWidget = () => {
    if (window.turnstile && widgetElement.current && widgetId.current === null) {
      widgetId.current = window.turnstile.render(widgetElement.current, { sitekey: siteKey, action: "login", callback: setToken });
    }
  };

  const resetWidget = () => {
    setToken("");
    if (window.turnstile && widgetId.current !== null) {
      window.turnstile.reset(widgetId.current);
    }
  };

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await startEmailLogin(email, token);
    setPending(false);
    setError(result?.error ?? null);
    if (result === null) {
      setStep("code");
    } else {
      // A Turnstile token works once.
      resetWidget();
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    const result = await finishEmailLogin(email, code);
    setPending(false);
    setError(result?.error ?? null);
  };

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={renderWidget} />
      {step === "email" ? (
        <form onSubmit={submitEmail} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <div ref={widgetElement} />
          <button type="submit" disabled={pending || token === ""} className={BUTTON_CLASS}>
            Email me a code
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="flex flex-col gap-4">
          <p className="text-sm text-[#5b5148]">We sent a code to {email}. Check your spam folder if you do not see it.</p>
          <label className="flex flex-col gap-1 text-sm">
            Code
            <input
              inputMode="numeric"
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <button type="submit" disabled={pending} className={BUTTON_CLASS}>
            Log in
          </button>
        </form>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </>
  );
};
