// Auth pages render full-screen on the navy background (no app shell).
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="login-screen">{children}</div>;
}
