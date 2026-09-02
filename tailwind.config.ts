import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f4f7fb",
          100: "#e8eef6",
          700: "#1e3a5f",
          800: "#152a46",
          900: "#0f1c2e",
          950: "#0a1320",
        },
        accent: {
          500: "#2f6fed",
          600: "#2458c7",
        },
      },
    },
  },
  plugins: [],
};

export default config;
