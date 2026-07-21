"use client";

import { useEffect, useState } from "react";

/*
 * Per-device Web Push enrollment (Profile → Notification Preferences).
 * Push is per-DEVICE: enabling here subscribes this browser/installed app
 * only. iPhones/iPads require the app installed to the home screen first
 * (Share → Add to Home Screen) — Safari tabs can't receive push.
 */

function vapidKeyBytes(base64url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type PushState =
  | "unsupported" // browser can't do push (or an iPhone not installed as app)
  | "unconfigured" // no VAPID key deployed
  | "off"
  | "on"
  | "denied" // permission blocked at the browser level
  | "working";

export function PushSetup() {
  const [state, setState] = useState<PushState>("unsupported");
  const [note, setNote] = useState("");

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

  useEffect(() => {
    if (!publicKey) {
      setState("unconfigured");
      return;
    }
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    void navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, [publicKey]);

  async function enable() {
    setState("working");
    setNote("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(publicKey) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("Couldn't save the subscription");
      setState("on");
      setNote("This device now gets Momentum+ notifications.");
    } catch (e) {
      setState("off");
      setNote(
        e instanceof Error && e.message
          ? e.message
          : "Couldn't enable push on this device.",
      );
    }
  }

  async function disable() {
    setState("working");
    setNote("");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState("off");
      setNote("Push turned off for this device.");
    } catch {
      setState("off");
    }
  }

  if (state === "unconfigured") return null; // feature not deployed yet

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "12px 0 2px",
        borderTop: "1px solid var(--border, #e8e4db)",
        marginTop: 12,
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 220 }}>
        <div className="pref-name">Push notifications (this device)</div>
        <div className="pref-desc">
          Alerts on your phone or computer even when the portal is closed.
          On iPhone/iPad, first install the app: Share &rarr; Add to Home
          Screen.
        </div>
      </div>
      {state === "unsupported" ? (
        <span style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
          Not available in this browser.
        </span>
      ) : state === "denied" ? (
        <span style={{ fontSize: 12.5, color: "var(--mid-gray)" }}>
          Notifications are blocked in your browser settings for this site.
        </span>
      ) : (
        <button
          type="button"
          className={state === "on" ? "btn-mini" : "btn-primary"}
          disabled={state === "working"}
          onClick={state === "on" ? disable : enable}
        >
          {state === "working"
            ? "Working…"
            : state === "on"
              ? "Turn off on this device"
              : "Enable on this device"}
        </button>
      )}
      {note && (
        <span style={{ fontSize: 12.5, color: "var(--mid-gray)", flexBasis: "100%" }}>
          {note}
        </span>
      )}
    </div>
  );
}
