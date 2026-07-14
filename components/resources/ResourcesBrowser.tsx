"use client";

import { useMemo, useState } from "react";
import type { ResourceItem } from "@/lib/directory-data";
import { recordResourceUse } from "@/app/(portal)/resources/actions";
import { DocIcon, ExternalIcon } from "@/components/icons";

const FILTERS = ["All Resources", "Leadership", "Business", "Wellness", "Communication"];

export function ResourcesBrowser({
  resources,
  unlockedIds,
}: {
  resources: ResourceItem[];
  unlockedIds: string[];
}) {
  const [filter, setFilter] = useState(FILTERS[0]);
  const unlocked = useMemo(() => new Set(unlockedIds), [unlockedIds]);

  const visible =
    filter === "All Resources"
      ? resources
      : resources.filter((r) => r.tags.includes(filter));

  function open(r: ResourceItem) {
    // Usage tracking (resource_uses) fires alongside the open.
    void recordResourceUse(r.id);
    if (r.url && r.url !== "#") window.open(r.url, "_blank", "noopener");
  }

  return (
    <>
      <div className="filter-row" style={{ marginTop: 4 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`filter-btn${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="resources-grid">
        {visible.map((r) => {
          const canOpen = unlocked.has(r.id);
          return (
            <div className="resource-card" key={r.id}>
              <div className="resource-icon" style={{ background: r.iconBg }}>
                <span style={{ color: r.typeColor }}>
                  <DocIcon size={20} />
                </span>
              </div>
              <div className="resource-body">
                <div className="resource-type" style={{ color: r.typeColor }}>
                  {r.type}
                </div>
                <div className="resource-title">{r.title}</div>
                <div className="resource-desc">{r.description}</div>
                <div className="resource-meta">
                  {r.tags.map((t) => (
                    <span className="resource-tag" key={t}>
                      {t}
                    </span>
                  ))}
                  {canOpen ? (
                    <button
                      type="button"
                      className="resource-link"
                      onClick={() => open(r)}
                    >
                      {r.actionLabel} <ExternalIcon size={12} />
                    </button>
                  ) : (
                    <span
                      className="resource-link"
                      style={{ color: "var(--mid-gray)", cursor: "default" }}
                      title="Available to VIP and annual members"
                    >
                      Exclusive
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
