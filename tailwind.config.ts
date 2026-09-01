import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0D0F10",
        surface: "#141719",
        surface2: "#191D1F",
        edge: "#292E31",
        fg: "#F1F0EB",
        sec: "#969C9E",
        mut: "#62696C",
        acc: "#C8F135",
        warn: "#E8B84B",
        bad: "#E06456",
      },
      fontFamily: {
        sans: ["var(--font-archivo)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        DEFAULT: "6px",
        sm: "4px",
        md: "8px",
        lg: "10px",
      },
    },
  },
  plugins: [],
};
export default config;
