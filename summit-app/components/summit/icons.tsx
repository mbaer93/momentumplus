import type { SVGProps } from "react";

// Summit-companion icons — stroke-only, same conventions as
// components/icons.tsx (SPEC.md §6: stroke-only SVG icons, NO emoji).
// Kept separate so the event app never touches Momentum+ files.

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SummitHomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 13.5L8 3l6 10.5" />
      <path d="M5.5 9L8 6.5 10.5 9" />
      <path d="M1 13.5h14" />
    </Svg>
  );
}

export function AgendaIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="2.5" width="12" height="11.5" rx="1" />
      <path d="M2 6h12" />
      <path d="M5 1v3M11 1v3" />
      <path d="M5 9h2M9 9h2M5 11.5h2" />
    </Svg>
  );
}

export function SpeakersMicIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="6" y="1.5" width="4" height="7" rx="2" />
      <path d="M3.5 7a4.5 4.5 0 009 0" />
      <path d="M8 11.5V14M5.5 14h5" />
    </Svg>
  );
}

export function VendorsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 6L3.5 2h9l1 4" />
      <path d="M2.5 6a1.8 1.8 0 003.6 0 1.9 1.9 0 003.8 0 1.8 1.8 0 003.6 0" />
      <path d="M3.5 8v6h9V8" />
      <path d="M6 14v-3.5h4V14" />
    </Svg>
  );
}

export function TicketIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 5.5V4a1 1 0 011-1h10a1 1 0 011 1v1.5a1.75 1.75 0 000 5V12a1 1 0 01-1 1H3a1 1 0 01-1-1v-1.5a1.75 1.75 0 000-5z" />
      <path d="M9.5 3.5v1.5M9.5 7.25v1.5M9.5 11v1.5" strokeDasharray="0.1 2.4" />
    </Svg>
  );
}

export function CommunityChatIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 3.5A1.5 1.5 0 013.5 2h6A1.5 1.5 0 0111 3.5v4A1.5 1.5 0 019.5 9H8l-2 2V9H3.5A1.5 1.5 0 012 7.5v-4z" />
      <path d="M11 5h1.5A1.5 1.5 0 0114 6.5v3a1.5 1.5 0 01-1.5 1.5H12l-1.5 1.5V11H10" />
    </Svg>
  );
}

export function MapPinIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 14.5S3 9.9 3 6.5a5 5 0 0110 0c0 3.4-5 8-5 8z" />
      <circle cx="8" cy="6.5" r="1.8" />
    </Svg>
  );
}

export function ArrowUpRightIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 11.5l7-7" />
      <path d="M5.5 4.5h6v6" />
    </Svg>
  );
}
