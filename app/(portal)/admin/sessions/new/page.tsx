import Link from "next/link";
import { SessionForm } from "@/components/admin/SessionForm";
import { ArrowLeftIcon } from "@/components/icons";
import {
  listAdminHostNames,
  listSpeakersForAdmin,
} from "@/lib/directory-queries";

export const dynamic = "force-dynamic";

export default async function NewSessionPage() {
  const [speakerList, adminHosts] = await Promise.all([
    listSpeakersForAdmin(),
    listAdminHostNames(),
  ]);
  const speakers = speakerList.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="admin-pad">
      <Link href="/admin/sessions" className="sess-back">
        <ArrowLeftIcon size={12} /> Back to sessions
      </Link>
      <div className="section-header">
        <div>
          <h2>New Session</h2>
          <p>Add a session to the schedule</p>
        </div>
      </div>
      <SessionForm mode="create" speakers={speakers} adminHosts={adminHosts} />
    </div>
  );
}
