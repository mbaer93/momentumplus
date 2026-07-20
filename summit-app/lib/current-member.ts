import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import { requestCache } from "@/lib/request-cache";

/*
 * Who's signed in — against the summit app's OWN Supabase project (fully
 * separate from Momentum+). There is no self-serve signup: every account
 * exists because the Sheet importer (or an admin) invited it, so a signed-in
 * user IS an attendee/team member. Admins are the profiles flagged is_admin
 * plus any email listed in SUMMIT_ADMIN_EMAILS (comma-separated) — the env
 * list bootstraps the first admin before any flag exists.
 */

export interface CurrentMember {
  id: string;
  name: string;
  email: string;
  initials: string;
  isAdmin: boolean;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "M"
  );
}

function isEnvAdmin(email: string): boolean {
  return (process.env.SUMMIT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function requireMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) redirect("/login");
  return member;
}

export const getCurrentMember = requestCache(
  async (): Promise<CurrentMember | null> => {
    if (!isSupabaseConfigured()) {
      // Preview mode (local dev only — deployed envs hard-fail in middleware).
      return {
        id: "preview-member",
        name: "Jordan Attendee",
        email: "attendee@example.com",
        initials: "JA",
        isAdmin: true,
      };
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    const email = profile?.email ?? user.email ?? "";
    const name = profile?.full_name || email || "Attendee";
    return {
      id: user.id,
      name,
      email,
      initials: initials(name),
      isAdmin: Boolean(profile?.is_admin) || isEnvAdmin(email),
    };
  },
);
