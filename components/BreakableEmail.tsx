import { Fragment } from "react";

/*
 * Render an email address that wraps at the "@" (and between domain
 * segments) instead of mid-word — "jamiefranks0913 / @gmail.com" reads as
 * intentional where "jamiefranks0913@gmail.co / m" reads as broken. <wbr>
 * marks the allowed break points; nothing changes when there's room.
 */
export function BreakableEmail({ email }: { email: string }) {
  const at = email.indexOf("@");
  if (at <= 0) return <>{email}</>;
  const user = email.slice(0, at);
  const domainParts = email.slice(at + 1).split(".");
  return (
    <>
      {user}
      <wbr />@
      {domainParts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              <wbr />.
            </>
          )}
          {p}
        </Fragment>
      ))}
    </>
  );
}
