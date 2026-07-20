import Link from "next/link";
import { WhitneyRoom } from "@/components/whitney/WhitneyRoom";
import { isPro } from "@/lib/access";
import { requireMember } from "@/lib/current-member";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "Whitney | Momentum+" };

/*
 * Whitney by SLC — a reflective thinking partner, exclusive to Pro.
 * Conversations are private to the member (RLS read-own; see migration
 * 0045) and persist between visits; "New conversation" starts clean.
 * The API route re-enforces the Pro gate — this page gate is UX only.
 */
export default async function WhitneyPage({
  searchParams,
}: {
  searchParams?: { c?: string };
}) {
  const member = await requireMember();

  if (!isPro(member.tier)) {
    return (
      <div className="whitney-pad">
        <div className="section-header">
          <div>
            <h2>Whitney by SLC</h2>
            <p>A reflective thinking partner — exclusive to Momentum+ Pro.</p>
          </div>
        </div>
        <div className="whitney-lock">
          <h3>Slow down. Hear yourself think.</h3>
          <p>
            Whitney doesn&apos;t give advice or hand you answers. She asks
            careful questions that help you make sense of what you&apos;re
            working through — and everything you say stays private to you.
          </p>
          <Link href="/upgrade" className="whitney-lock-cta">
            Upgrade to Pro
          </Link>
        </div>
      </div>
    );
  }

  let conversations: { id: string; title: string }[] = [];
  let activeId: string | null = null;
  let messages: { role: "user" | "assistant"; content: string }[] = [];

  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data: convRows } = await supabase
      .from("whitney_conversations")
      .select("id, title")
      .order("updated_at", { ascending: false })
      .limit(50);
    conversations = (convRows ?? []).map((c) => ({
      id: c.id as string,
      title: (c.title as string) || "Conversation",
    }));

    const requested = searchParams?.c;
    if (requested === "new") {
      activeId = null;
    } else if (requested && conversations.some((c) => c.id === requested)) {
      activeId = requested;
    } else {
      activeId = conversations[0]?.id ?? null;
    }

    if (activeId) {
      const { data: msgRows } = await supabase
        .from("whitney_messages")
        .select("role, content")
        .eq("conversation_id", activeId)
        .order("created_at", { ascending: true });
      messages = (msgRows ?? [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content as string,
        }));
    }
  }

  return (
    <div className="whitney-pad">
      <div className="section-header">
        <div>
          <h2>Whitney by SLC</h2>
          <p>
            A place to slow down and think something through. Private to you.
          </p>
        </div>
      </div>
      {/* Keyed by conversation so switching threads remounts with fresh
          server-loaded messages (useState initials don't track props). */}
      <WhitneyRoom
        key={activeId ?? "new"}
        initialConversations={conversations}
        initialActiveId={activeId}
        initialMessages={messages}
      />
    </div>
  );
}
