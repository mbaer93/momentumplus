"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { CloseIcon, MenuIcon } from "@/components/icons";

/*
 * Mobile navigation state for the portal shell. On phones the sidebar is an
 * off-canvas drawer: a hamburger in the topbar opens it, tapping the backdrop
 * or navigating closes it. Above the mobile breakpoint the drawer CSS is
 * inert and the sidebar renders exactly as before.
 */
const NavContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function PortalNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating anywhere closes the drawer.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes it too.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <NavContext.Provider value={{ open, setOpen }}>
      <div className={`app-shell${open ? " nav-open" : ""}`}>{children}</div>
    </NavContext.Provider>
  );
}

export function MobileNavToggle() {
  const { setOpen } = useContext(NavContext);
  return (
    <button
      type="button"
      className="topbar-icon-btn mobile-nav-toggle"
      aria-label="Open menu"
      onClick={() => setOpen(true)}
    >
      <MenuIcon size={18} />
    </button>
  );
}

export function MobileNavClose() {
  const { setOpen } = useContext(NavContext);
  return (
    <button
      type="button"
      className="sidebar-close mobile-only"
      aria-label="Close menu"
      onClick={() => setOpen(false)}
    >
      <CloseIcon size={16} />
    </button>
  );
}

export function MobileNavBackdrop() {
  const { open, setOpen } = useContext(NavContext);
  return (
    <div
      className={`sidebar-backdrop${open ? " show" : ""}`}
      onClick={() => setOpen(false)}
      aria-hidden="true"
    />
  );
}
