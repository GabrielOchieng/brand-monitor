/** @type {import('tailwindcss').Config} */
// Design tokens (UI redesign, 2026-11). One place for the product's look:
//   - a cool light workspace (base < surface/panel < elevated) with a navy app shell around it,
//   - one restrained accent ("brand", a deep petrol teal: reads as security/intelligence without
//     the default-blue or AI-violet look), used for primary actions, focus and the active page,
//   - semantic severity colours that mean the same thing on every screen,
//   - Inter for text and JetBrains Mono for the data people scan: domains, IPs, references.
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        critical: "#c81e1e",
        high: "#d9480f",
        medium: "#b7791f",
        low: "#5b6473",
        base: "#f4f6f9",
        surface: "#ffffff",
        panel: "#ffffff",
        elevated: "#edf0f4",
        line: "#dfe3ea",
        ink: {
          DEFAULT: "#0f1623",
          muted: "#3f4859",
          subtle: "#637083",
          faint: "#97a1b1",
        },
        brand: {
          DEFAULT: "#0d6c76",
          hover: "#0a5860",
          strong: "#084a51",
          soft: "#e5f2f3",
          muted: "#0d6c7614",
        },
        // The navigation shell (sidebar, public header/footer, auth side panel).
        shell: {
          DEFAULT: "#0b1322",
          raised: "#121c2f",
          line: "#1e2a40",
          ink: "#e6ebf2",
          muted: "#97a3b8",
          faint: "#64718a",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 22 35 / 0.04), 0 1px 3px 0 rgb(15 22 35 / 0.06)",
        pop: "0 8px 24px -6px rgb(15 22 35 / 0.18), 0 2px 6px -2px rgb(15 22 35 / 0.08)",
      },
    },
  },
  plugins: [],
};
