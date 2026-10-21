import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App.tsx"
import "./styles/global.css"

applyBootTheme()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

function applyBootTheme() {
  const saved = window.localStorage.getItem("aftertrace-theme")
  const theme =
    saved === "dark" || saved === "light"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
  document.documentElement.dataset.theme = theme
}
