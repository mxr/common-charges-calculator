import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuth } from "@/app/_server/services";

export const dynamic = "force-dynamic";

const logOut = async () => {
  "use server";
  await getAuth().signOut();
  redirect("/login");
};

export default async function BuildingsPage() {
  const { data: session } = await getAuth().getSession();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Buildings</h1>
      <p className="text-sm text-[#5b5148]">Logged in as {session.user.email}.</p>
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm underline">
          Open the calculator
        </Link>
        <form action={logOut}>
          <button type="submit" className="rounded-xl bg-[#1a1b1f] px-4 py-2 text-sm font-medium text-white">
            Log out
          </button>
        </form>
      </div>
    </main>
  );
}
