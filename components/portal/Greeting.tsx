"use client";

import { useEffect, useState } from "react";

/*
 * Time-of-day greeting computed in the member's own timezone (client-side —
 * the server's clock is UTC). Renders a neutral "Welcome back" first so the
 * server and client HTML match, then settles on morning/afternoon/evening.
 */
function label(hour: number): string {
  if (hour < 4) return "Good evening"; // night owls
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function Greeting({ name }: { name: string }) {
  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    setGreeting(label(new Date().getHours()));
  }, []);

  return (
    <h1>
      {greeting}, {name}
    </h1>
  );
}
