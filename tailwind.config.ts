import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forest: { DEFAULT: "#183D32", 50: "#EEF4F1", 100: "#D5E5DD", 700: "#1F4D3F", 800: "#183D32", 900: "#0F2921" },
        leaf: { DEFAULT: "#4C956C", 50: "#EDF6F0", 100: "#D3EADB", 600: "#3E7D59", 700: "#33684A" },
        cream: { DEFAULT: "#F7F4EA", 100: "#FBFAF4", 200: "#EFEADB", 300: "#E3DCC6" },
        gold: { DEFAULT: "#E6B85C", 100: "#FBF0D9", 600: "#C9972F", 700: "#9C7322" },
        muted: { DEFAULT: "#737B76", 300: "#B9BFBB" },
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans Devanagari", "system-ui", "sans-serif"],
        hindi: ["Noto Sans Devanagari", "Inter", "sans-serif"],
        display: ["Tiro Devanagari Hindi", "Noto Serif Devanagari", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(24,61,50,0.06), 0 8px 24px -12px rgba(24,61,50,0.18)",
        lift: "0 12px 32px -12px rgba(24,61,50,0.35)",
      },
      borderRadius: { xl2: "1.25rem" },
      keyframes: {
        fadeUp: { "0%": { opacity: "0", transform: "translateY(8px)" }, "100%": { opacity: "1", transform: "none" } },
      },
      animation: { "fade-up": "fadeUp .35s ease-out both" },
    },
  },
  plugins: [],
} satisfies Config;
