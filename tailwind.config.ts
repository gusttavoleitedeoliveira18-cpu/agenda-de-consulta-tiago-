import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: { grafite: "#111614", floresta: "#1B2420", marfim: "#F5F7F2", lima: "#B9E747", neblina: "#AAB5AE" },
    fontFamily: { display: ["var(--f-display)"], sans: ["var(--f-body)"] },
  } },
} satisfies Config;
