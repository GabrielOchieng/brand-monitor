/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        critical: "#dc2626",
        high: "#ea580c",
        medium: "#ca8a04",
        low: "#4b5563",
        // A layered light surface system (page < panel < card < hover) instead of one
        // flat white-on-white -- gives the UI real depth without reaching for a dark
        // theme (a near-black bg + gray-800 borders + blue-600 accent is the exact look
        // that reads as generic/AI-scaffolded).
        base: "#f4f5f7",
        surface: "#ffffff",
        panel: "#ffffff",
        elevated: "#eef0f3",
        line: "#e3e5ea",
        // Semantic text scale (was raw text-gray-100..600 tuned for a dark backdrop,
        // scattered across every page) -- one place to invert for a light background.
        ink: {
          DEFAULT: "#12141a",
          muted: "#454a54",
          subtle: "#6b7280",
          faint: "#9aa0ab",
        },
        brand: {
          DEFAULT: "#5b4fe0",
          hover: "#4c41cc",
          muted: "#5b4fe014",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)",
      },
    },
  },
  plugins: [],
};
