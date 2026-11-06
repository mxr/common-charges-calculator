import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingInvite } from "@/app/_components/pending-invite";
import { PendingSave } from "@/app/_components/pending-save";
import { BUTTON_CLASS, INPUT_CLASS, LINK_CLASS } from "@/app/_components/styles";
import { getAuth, getDb, requireUser } from "@/app/_server/services";
import { listBuildings } from "@/lib/server/store";
import { createBuildingAction } from "./actions";

export const dynamic = "force-dynamic";

const logOut = async () => {
  "use server";
  await getAuth().signOut();
  redirect("/login");
};

export default async function BuildingsPage() {
  const user = await requireUser();
  const buildings = await listBuildings(getDb(), user.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Buildings</h1>
      <p className="text-sm text-[#5b5148]">Logged in as {user.email}.</p>
      <PendingInvite />
      <PendingSave />
      {buildings.length === 0 ? (
        <p className="text-sm text-[#5b5148]">You have no buildings yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {buildings.map((building) => (
            <li key={building.id}>
              <Link href={`/buildings/${building.id}`} className={LINK_CLASS}>
                {building.name}
              </Link>
              {building.isAdmin ? null : <span className="text-sm text-[#5b5148]"> (shared with you)</span>}
            </li>
          ))}
        </ul>
      )}
      <form action={createBuildingAction} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          New building
          <input name="name" required maxLength={200} placeholder="Maple Court" className={INPUT_CLASS} />
        </label>
        <button type="submit" className={BUTTON_CLASS}>
          Create
        </button>
      </form>
      <div className="flex items-center gap-4">
        <Link href="/" className="text-sm underline">
          Open the calculator
        </Link>
        <form action={logOut}>
          <button type="submit" className={BUTTON_CLASS}>
            Log out
          </button>
        </form>
      </div>
    </main>
  );
}
