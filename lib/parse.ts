import { makeId } from "./budget";
import type { Owner, Unit } from "./types";

export type SkippedLine = { line: string; reason: string };

export type ParsedOwners = { owners: Owner[]; skipped: SkippedLine[] };
export type ParsedUnits = { units: Unit[]; skipped: SkippedLine[] };

// Each line is "name, current monthly" (comma or tab separated). The amount is optional
// and may have a $ prefix. Exclusion is not supported in batch input.
export const parseOwnerLines = (text: string): ParsedOwners => {
  const owners: Owner[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const [name = "", amountRaw = ""] = raw.split(/\s*,\s*|\t+/).map((part) => part.trim());
    if (!name) {
      continue;
    }
    const amount = Number(amountRaw.replace(/[$,]/g, ""));
    owners.push({ id: makeId("owner"), name, excluded: false, currentMonthly: Number.isFinite(amount) ? amount : 0 });
  }
  return { owners, skipped: [] };
};

// Each line is "label, type, common interest, owner" (comma or tab separated).
// Owner is matched by name (case-insensitive) against existing owners.
export const parseUnitLines = (text: string, unitTypes: string[], owners: Owner[]): ParsedUnits => {
  const units: Unit[] = [];
  const skipped: SkippedLine[] = [];
  const typeByName = new Map(unitTypes.map((type) => [type.toLowerCase(), type]));
  const ownerByName = new Map(owners.map((owner) => [owner.name.trim().toLowerCase(), owner.id]));

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const [label = "", typeRaw = "", ciRaw = "", ownerName = ""] = line.split(/\s*,\s*|\t+/).map((part) => part.trim());
    if (!label || !typeRaw || !ciRaw || !ownerName) {
      skipped.push({ line, reason: "expected: label, type, common interest, owner" });
      continue;
    }
    const type = typeByName.get(typeRaw.toLowerCase());
    if (!type) {
      skipped.push({ line, reason: `unknown type "${typeRaw}"` });
      continue;
    }
    const commonInterest = Number(ciRaw.replace(/%/g, "").trim());
    if (!Number.isFinite(commonInterest) || ciRaw.replace(/%/g, "").trim() === "") {
      skipped.push({ line, reason: `invalid common interest "${ciRaw}"` });
      continue;
    }
    const ownerId = ownerByName.get(ownerName.toLowerCase());
    if (!ownerId) {
      skipped.push({ line, reason: `unknown owner "${ownerName}"` });
      continue;
    }
    units.push({ id: makeId("unit"), label, type, commonInterest, ownerId });
  }

  return { units, skipped };
};
