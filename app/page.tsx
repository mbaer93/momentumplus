import { redirect } from "next/navigation";

// The portal entry point. Middleware sends unauthenticated users to /login;
// authenticated members land on the dashboard.
export default function Home() {
  redirect("/dashboard");
}
