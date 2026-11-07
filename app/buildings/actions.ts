"use server";

import { redirect } from "next/navigation";
import { getDb, requireUser } from "@/app/_server/services";
import { accessBudget, adminOfBudget, adminOfBuilding, adminOfProject } from "@/lib/server/access";
import {
  createBudget,
  createBuilding,
  createProject,
  deleteBuilding,
  deleteProject,
  parseName,
  renameBuilding,
  renameProject,
} from "@/lib/server/store";

export const createBuildingAction = async (form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const name = parseName(form.get("name"));
  if (name === null) {
    return;
  }
  redirect(`/buildings/${await createBuilding(getDb(), userId, name)}`);
};

export const createProjectAction = async (buildingId: string, form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await adminOfBuilding(db, userId, buildingId);
  const name = parseName(form.get("name"));
  if (access === null || name === null) {
    return;
  }
  await createProject(db, access, name);
  redirect(`/buildings/${buildingId}`);
};

export const renameBuildingAction = async (buildingId: string, form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await adminOfBuilding(db, userId, buildingId);
  const name = parseName(form.get("name"));
  if (access === null || name === null) {
    return;
  }
  await renameBuilding(db, access, name);
  redirect(`/buildings/${buildingId}`);
};

// The form sends the name the admin typed to confirm.
export const deleteBuildingAction = async (buildingId: string, form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await adminOfBuilding(db, userId, buildingId);
  const typed = parseName(form.get("confirm"));
  if (access === null || typed === null || !(await deleteBuilding(db, access, typed))) {
    return;
  }
  redirect("/buildings");
};

export const renameProjectAction = async (projectId: string, form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await adminOfProject(db, userId, projectId);
  const name = parseName(form.get("name"));
  if (access === null || name === null) {
    return;
  }
  await renameProject(db, access, name);
  redirect(`/buildings/${access.buildingId}`);
};

export const deleteProjectAction = async (projectId: string, form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await adminOfProject(db, userId, projectId);
  const typed = parseName(form.get("confirm"));
  if (access === null || typed === null || !(await deleteProject(db, access, typed))) {
    return;
  }
  redirect(`/buildings/${access.buildingId}`);
};

export const createBudgetAction = async (projectId: string, form: FormData): Promise<void> => {
  const { id: userId } = await requireUser();
  const db = getDb();
  const access = await adminOfProject(db, userId, projectId);
  const name = parseName(form.get("name"));
  const copyFromId = form.get("copyFrom");
  const copyAccess = typeof copyFromId === "string" && copyFromId !== "" ? await accessBudget(db, userId, copyFromId) : null;
  // Copying can start from a draft, so it needs the admin's access to the copied budget.
  const copyFrom = copyAccess === null ? null : adminOfBudget(copyAccess);
  if (access === null || name === null || (copyFromId && copyFrom === null)) {
    return;
  }
  const { budgetId, draftId } = await createBudget(db, access, name, copyFrom);
  redirect(`/budgets/${budgetId}/drafts/${draftId}`);
};
