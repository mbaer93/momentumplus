import type { SVGProps } from "react";

// Stroke-only SVG icons extracted verbatim from mockup/momentum-plus-v5.html
// (SPEC.md §6: stroke-only SVG icons, NO emoji). Size defaults to 16px.

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

export function DashboardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </Svg>
  );
}

export function CommunityIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 3.5A1.5 1.5 0 013.5 2h6A1.5 1.5 0 0111 3.5v4A1.5 1.5 0 019.5 9H8l-2 2V9H3.5A1.5 1.5 0 012 7.5v-4z" />
      <path d="M11 5h1.5A1.5 1.5 0 0114 6.5v3a1.5 1.5 0 01-1.5 1.5H12l-1.5 1.5V11H10" />
    </Svg>
  );
}

export function SessionsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1" y="2" width="14" height="10" rx="1.5" />
      <path d="M5 14h6" />
      <path d="M8 12v2" />
      <path d="M6.5 5.5l4 2.5-4 2.5V5.5z" />
    </Svg>
  );
}

export function LibraryIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="8" r="5.5" />
      <path d="M5.5 6l4 2-4 2V6z" />
      <path d="M14 4v8" />
      <path d="M12 5v6" />
    </Svg>
  );
}

export function EducationIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2.5L1 5.75 8 9l7-3.25L8 2.5z" />
      <path d="M3.75 7v3.25c0 1.1 1.9 2.25 4.25 2.25s4.25-1.15 4.25-2.25V7" />
      <path d="M15 5.75v3.5" />
      <path d="M15 9.25l-.75 1.5h1.5L15 9.25z" />
    </Svg>
  );
}

export function SpeakersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5" y="1" width="6" height="8" rx="3" />
      <path d="M3 8a5 5 0 0010 0" />
      <path d="M8 13v2" />
      <path d="M6 15h4" />
    </Svg>
  );
}

export function ResourcesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 13.5S4 12 2 12V3c2 0 6 1.5 6 1.5S12 3 14 3v9c-2 0-6 1.5-6 1.5z" />
      <path d="M8 4.5v9" />
    </Svg>
  );
}

export function SponsorsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="6" r="4" />
      <path d="M5.7 9.3L4.5 14.5l3.5-2 3.5 2-1.2-5.2" />
    </Svg>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" />
      <path d="M1.5 6.5h13" />
      <path d="M5 1.5v2" />
      <path d="M11 1.5v2" />
      <rect x="4" y="9" width="2" height="2" rx=".5" />
      <rect x="7" y="9" width="2" height="2" rx=".5" />
      <rect x="10" y="9" width="2" height="2" rx=".5" />
    </Svg>
  );
}

export function ProfileIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="6.5" r="2" />
      <path d="M3.5 13a5 5 0 019 0" />
    </Svg>
  );
}

export function AdminIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 1.5l5.5 2v4.5c0 3-2.5 5.5-5.5 6.5C5 13.5 2.5 11 2.5 8V3.5L8 1.5z" />
      <path d="M7 5.5l-1.5 3h3L7 12" />
    </Svg>
  );
}

export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v1.5m0 11V15m5-9.5l-1.3.75m-7.4 4.5L3 12m10-1.5l-1.3-.75M4.3 5.25L3 4M15 8h-1.5m-11 0H1" />
    </Svg>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3 3" />
    </Svg>
  );
}

export function BellIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 1.5a4.5 4.5 0 00-4.5 4.5c0 2.5-.5 3.5-1.5 4.5h12c-1-1-1.5-2-1.5-4.5A4.5 4.5 0 008 1.5z" />
      <path d="M6.5 10.5a1.5 1.5 0 003 0" />
    </Svg>
  );
}

export function ChevronRightIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M6 3l5 5-5 5" />
    </Svg>
  );
}

export function CalendarSmallIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" />
      <path d="M1.5 6.5h13" />
      <path d="M5 1.5v2" />
      <path d="M11 1.5v2" />
    </Svg>
  );
}

export function TargetIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="3.5" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </Svg>
  );
}

export function MessageIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v5A1.5 1.5 0 0112.5 10H9l-3 3V10H3.5A1.5 1.5 0 012 8.5v-5z" />
    </Svg>
  );
}

export function StarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <polygon points="8,1 10,6 15,6 11,9 13,14 8,11 3,14 5,9 1,6 6,6" />
    </Svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 1.5l5.5 2v4.5c0 3-2.5 5.5-5.5 6.5C5 13.5 2.5 11 2.5 8V3.5L8 1.5z" />
      <path d="M7 5.5l-1.5 3h3L7 12" />
    </Svg>
  );
}

export function ChannelIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="4" y1="3" x2="3" y2="13" />
      <line x1="13" y1="3" x2="12" y2="13" />
      <line x1="1.5" y1="6" x2="14.5" y2="6" />
      <line x1="1.5" y1="10" x2="14.5" y2="10" />
    </Svg>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 5v3l2 2" />
    </Svg>
  );
}

// Duration mark (replaces the mockup's ⏱ emoji per the no-emoji rule).
export function TimerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="9" r="5.5" />
      <path d="M8 6v3" />
      <path d="M6 1.5h4" />
      <path d="M12.5 4l1 1" />
    </Svg>
  );
}

export function UsersIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 13a4.5 4.5 0 019 0" />
      <circle cx="12" cy="5.5" r="2" />
      <path d="M14.5 13a3 3 0 00-4-2.8" />
    </Svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M3 8.5l3.5 3.5L13 4.5" />
    </Svg>
  );
}

export function ArrowLeftIcon(p: IconProps) {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M10 3L5 8l5 5" />
    </Svg>
  );
}

export function DocIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 1.5h5l3 3v10a.5.5 0 01-.5.5h-7A.5.5 0 014 14.5v-13z" />
      <path d="M9 1.5v3h3" />
    </Svg>
  );
}

export function ExternalIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 3H3.5A1.5 1.5 0 002 4.5v8A1.5 1.5 0 003.5 14h8a1.5 1.5 0 001.5-1.5V10" />
      <path d="M9 2h5v5" />
      <path d="M14 2L7 9" />
    </Svg>
  );
}

export function SparkleIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 1.5l1.6 4.4L14 7.5l-4.4 1.6L8 13.5l-1.6-4.4L2 7.5l4.4-1.6L8 1.5z" />
    </Svg>
  );
}

export function EditIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11.3 2.2l2.5 2.5L5.5 13H3v-2.5l8.3-8.3z" />
      <path d="M9.8 3.7l2.5 2.5" />
    </Svg>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </Svg>
  );
}
