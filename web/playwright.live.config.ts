import { defineConfig } from "@playwright/test"

// Smoke tests against the real binary (aftertrace demo + serve), not the mock
// build. CI starts the server; locally: build:embed, go build, demo, serve.
export default defineConfig({
  testDir: "./e2e-live",
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.AFTERTRACE_URL || "http://127.0.0.1:7311",
    viewport: { width: 1440, height: 900 },
  },
})
