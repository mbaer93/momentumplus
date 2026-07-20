import Link from "next/link";
import { WhitneyPromptEditor } from "@/components/admin/WhitneyPromptEditor";
import { isAnthropicReady, getServiceSettings } from "@/lib/service-config";
import { DEFAULT_WHITNEY_PROMPT } from "@/lib/whitney";

export const dynamic = "force-dynamic";

export const metadata = { title: "Whitney | Momentum+ Admin" };

/*
 * Admin editor for Whitney's instructions (the system prompt behind the
 * Pro-only reflective guide on /whitney). The built-in version is frozen in
 * code; anything saved here overrides it instantly, no deploy needed.
 */
export default async function AdminWhitneyPage() {
  const [override, anthropicReady] = await Promise.all([
    getServiceSettings<{ prompt?: string }>("whitney"),
    isAnthropicReady(),
  ]);
  const overridePrompt = override?.prompt?.trim() ?? "";
  const isOverridden = overridePrompt.length > 0;

  return (
    <div className="admin-pad">
      <div className="section-header">
        <div>
          <h2>Whitney by SLC</h2>
          <p>
            The instructions behind the Pro members&apos; reflective guide.
            Edits apply to new messages immediately.
          </p>
        </div>
      </div>

      {!anthropicReady && (
        <p className="whitney-admin-warn">
          Anthropic isn&apos;t connected, so Whitney can&apos;t reply yet —
          connect it in <Link href="/admin/connections">Connections</Link>.
        </p>
      )}

      <p className="whitney-admin-status">
        {isOverridden
          ? "Whitney is running on a custom override saved here."
          : "Whitney is running on the built-in (frozen) instructions. Saving below creates an override; you can always reset."}
        {" "}Member conversations are private — admins cannot read them.
      </p>

      <WhitneyPromptEditor
        currentPrompt={isOverridden ? overridePrompt : DEFAULT_WHITNEY_PROMPT}
        defaultPrompt={DEFAULT_WHITNEY_PROMPT}
        isOverridden={isOverridden}
      />
    </div>
  );
}
