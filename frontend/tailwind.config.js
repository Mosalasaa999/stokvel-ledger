export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: {
          canvas: "#FAF7F0",
          card: "#FFFFFF",
          ruled: "#D6CFC2",
          subtle: "#F1ECE1"
        },
        ink: {
          primary: "#14181F",
          secondary: "#374151",
          muted: "#4B5563"
        },
        stokvel: {
          green: "#0F6B3A",
          greenBg: "#E6F4EC",
          amber: "#9A4D00",
          amberBg: "#FEF3C7",
          alert: "#991B1B",
          alertBg: "#FEE2E2"
        }
      },
      fontSize: {
        base: ["1.125rem", { lineHeight: "1.55" }],
        lg: ["1.25rem", { lineHeight: "1.5" }],
        xl: ["1.5rem", { lineHeight: "1.35" }],
        pot: ["2.5rem", { lineHeight: "1.15" }]
      },
      spacing: {
        tap: "3.5rem",
        keypad: "4rem"
      }
    }
  },
  plugins: []
};