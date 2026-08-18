import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    historyApiFallback: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.js"],
    // Tests live only in src/tests/ — a *.test.jsx left beside a component will
    // not be collected, which is the signal to move it.
    include: ["src/tests/**/*.test.{js,jsx}"],
  },
});
