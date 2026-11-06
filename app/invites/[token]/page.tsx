import Link from "next/link";
import { redirect } from "next/navigation";
import { LogInToAccept } from "@/app/_components/pending-invite";
import { BUTTON_CLASS, LINK_CLASS } from "@/app/_components/styles";
import { getAuth, getDb } from "@/app/_server/services";
import { peekInvite } from "@/lib/server/store";
import { acceptInviteAction } from "../actions";

export const dynamic = "force-dynamic";

const PROBLEM_TEXT = {
  invalid: "This invite link does not work. It may have been revoked. Ask for a new one.",
  expired: "This invite link has expired. Ask for a new one.",
  used: "This invite link was already used. Ask for a new one.",
} as const;

// The proxy does not cover this route, because its login redirect would lose the token.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: session } = await getAuth().getSession();
  const invite = session?.user ? await peekInvite(getDb(), session.user.id, token, new Date()) : null;
  if (invite?.status === "open") {
    redirect(`/budgets/${invite.budgetId}`);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Budget invite</h1>
      {invite === null ? (
        <>
          <p className="text-sm text-[#5b5148]">You were invited to a budget. Log in, or create an account, to accept.</p>
          <LogInToAccept token={token} />
        </>
      ) : invite.status === "valid" ? (
        <>
          <p className="text-sm">
            Join <strong>{invite.budgetName}</strong> as {invite.role === "editor" ? "an editor" : "a viewer"}.
          </p>
          <form action={acceptInviteAction.bind(null, token)}>
            <button type="submit" className={BUTTON_CLASS}>
              Accept
            </button>
          </form>
        </>
      ) : (
        <>
          <p role="alert" className="text-sm">
            {PROBLEM_TEXT[invite.status]}
          </p>
          <Link href="/buildings" className={`${LINK_CLASS} text-sm`}>
            Go to your buildings
          </Link>
        </>
      )}
    </main>
  );
}
