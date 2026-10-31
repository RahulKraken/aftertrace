// Cross-platform embed build. Unix `VAR=value cmd` is not valid on Windows cmd
// (`'VITE_USE_MOCK' is not recognized as an internal or external command`).
import { execSync } from "node:child_process"

const env = { ...process.env, VITE_USE_MOCK: "0" }
execSync("tsc -b", { stdio: "inherit", env })
execSync("vite build", { stdio: "inherit", env })
