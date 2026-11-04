import { redirect } from "next/navigation";
import { getAuth, getSiteKey } from "@/app/_server/services";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { data: session } = await getAuth().getSession();
  if (session?.user) {
    redirect("/buildings");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <LoginForm siteKey={getSiteKey()} />
    </main>
  );
}
