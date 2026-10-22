// Local only: the UI in dev mode against a running aftertrace serve on :7311.
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.VITE_USE_MOCK": JSON.stringify("0") },
  server: { host: "127.0.0.1", port: 5199, proxy: { "/api": "http://127.0.0.1:7311" } },
})
