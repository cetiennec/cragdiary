import { isAdmin } from "@/lib/admin-stats";

/**
 * Who sees what is half-built.
 *
 * Two sources, one answer, and this is the only place they are added together:
 * the admin (`ADMIN_USERNAME`, an environment variable, unchanged) and the
 * accounts flagged `beta` from the admin page (migration 043). An admin is a
 * tester by definition and needs no flag.
 *
 * Being a tester is not a permission to touch anyone else's things. It only
 * decides what is *shown*; every feature behind it keeps its own rules about
 * whose day may be edited, published or deleted.
 */
export function isBetaUser(
  user: { username: string; beta?: boolean } | null | undefined
): boolean {
  if (!user) return false;
  return isAdmin(user.username) || user.beta === true;
}
