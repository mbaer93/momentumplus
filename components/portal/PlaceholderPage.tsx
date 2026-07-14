import type { ComponentType } from "react";

interface PlaceholderPageProps {
  title: string;
  subtitle: string;
  description: string;
  phase: string;
  icon: ComponentType<{ size?: number }>;
}

// Shared placeholder for portal destinations whose backend/feature ships in a
// later phase. Keeps the shell navigable while matching the design system.
export function PlaceholderPage({
  title,
  subtitle,
  description,
  phase,
  icon: Icon,
}: PlaceholderPageProps) {
  return (
    <div className="dash-pad">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="placeholder">
        <div className="placeholder-icon">
          <Icon size={26} />
        </div>
        <h3>Coming in {phase}</h3>
        <p>{description}</p>
        <span className="phase-tag">{phase}</span>
      </div>
    </div>
  );
}
