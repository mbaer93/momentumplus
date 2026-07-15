/*
 * Admin access model: the Super Admin can do everything including managing
 * other admins; standard admins are limited to areas the super admin has
 * left enabled (default: all areas on, so a fresh admin works out of the
 * box and access is *removed*, not granted, per area).
 */

export const ADMIN_AREAS = [
  { key: "sessions", label: "Sessions" },
  { key: "members", label: "Members & onboarding" },
  { key: "announcements", label: "Announcements" },
  { key: "sponsors", label: "Sponsors" },
  { key: "content", label: "Content — Library, Speakers, Resources, Education" },
] as const;

export type AdminArea = (typeof ADMIN_AREAS)[number]["key"];

export type AdminRole = "super" | "standard";

export interface AdminAccess {
  role: AdminRole;
  /** Area → allowed. Missing key = allowed (deny is explicit). */
  perms: Record<string, boolean>;
}

export function canAccessArea(
  access: AdminAccess | null,
  area: AdminArea,
): boolean {
  if (!access) return false;
  if (access.role === "super") return true;
  return access.perms[area] !== false;
}
