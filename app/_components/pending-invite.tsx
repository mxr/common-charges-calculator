"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BUTTON_CLASS } from "./styles";

// Holds the token of an invite opened before login. Login cannot carry a return URL, so the token waits here.
const PENDING_INVITE_KEY = "pendingInvite";

const takePendingInvite = (): string | null => {
  try {
    const token = window.localStorage.getItem(PENDING_INVITE_KEY);
    window.localStorage.removeItem(PENDING_INVITE_KEY);
    return token;
  } catch {
    return null;
  }
};

// Login lands on /buildings, which sends the account back to the invite it opened.
export const PendingInvite = () => {
  const router = useRouter();
  useEffect(() => {
    const token = takePendingInvite();
    if (token !== null) {
      router.replace(`/invites/${encodeURIComponent(token)}`);
    }
  }, [router]);
  return null;
};

export const LogInToAccept = ({ token }: { token: string }) => {
  const logIn = () => {
    try {
      window.localStorage.setItem(PENDING_INVITE_KEY, token);
    } catch {}
    window.location.assign("/login");
  };
  return (
    <button type="button" className={BUTTON_CLASS} onClick={logIn}>
      Log in to accept
    </button>
  );
};
