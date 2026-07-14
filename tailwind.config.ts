import type { Config } from "tailwindcss";

// Design tokens mirror mockup/momentum-plus-v5.html (SPEC.md §6 — copy exactly).
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0B1622",
        "navy-2": "#14243A",
        "navy-3": "#1C3050",
        cream: "#F8F6F1",
        "warm-gray": "#EDE9E3",
        "mid-gray": "#B0A99E",
        text: "#1A2332",
        gold: "#B8965A",
        "gold-light": "#D4AE75",
        "gold-pale": "#F4EDE0",
        "accent-red": "#A04040",
        "accent-blue": "#3A6B96",
        "accent-green": "#3A7055",
        purple: "#5C3D7A",
      },
      fontFamily: {
        // Wired to next/font CSS variables in app/layout.tsx
        serif: ["var(--font-playfair)", "Playfair Display", "serif"],
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
      },
      borderRadius: {
        // Spec: 4px radii for controls; larger radii used by cards in the mockup.
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};

export default config;
