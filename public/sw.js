/*
 * Momentum+ service worker: Web Push only.
 * No fetch/caching handlers on purpose — a stale-cache bug in a members
 * portal is worse than no offline support. The worker exists so installed
 * PWAs (and browsers) can receive push notifications.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Momentum+", body: "", link: "/dashboard" };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    /* non-JSON push — show the generic notification */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { link: payload.link },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        // An open portal tab: focus it and steer it to the link.
        if ("focus" in win) {
          win.navigate(link).catch(() => undefined);
          return win.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
