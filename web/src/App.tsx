import { useEffect, useState } from "react"
import { MotionConfig } from "motion/react"
import { Route, Router, Switch } from "wouter"
import { useHashLocation } from "wouter/use-hash-location"
import { Shell } from "./components/Shell"
import { EmptyState } from "./components/EmptyState"
import { ToastHost } from "./lib/toast"
import { applyTheme, readTheme, type Theme } from "./lib/theme"
import { CostPage } from "./pages/CostPage"
import { FindingsPage } from "./pages/FindingsPage"
import { QueryPage } from "./pages/QueryPage"
import { SessionPage } from "./pages/SessionPage"
import { SessionsPage } from "./pages/SessionsPage"
import { TracePage } from "./pages/TracePage"

function useHashPath(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const [loc, nav] = useHashLocation()
  return [loc.split("?")[0], nav]
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const mock = import.meta.env.VITE_USE_MOCK !== "0"

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <MotionConfig reducedMotion="user">
      <ToastHost>
      <Router hook={useHashPath}>
        <Shell theme={theme} onTheme={setTheme} mock={mock}>
          <Switch>
            <Route path="/" component={SessionsPage} />
            <Route path="/session/:id" component={SessionPage} />
            <Route path="/trace/:id" component={TracePage} />
            <Route path="/findings" component={FindingsPage} />
            <Route path="/query" component={QueryPage} />
            <Route path="/cost" component={CostPage} />
            <Route path="/empty">
              <div className="page">
                <EmptyState />
              </div>
            </Route>
            <Route>
              <div className="page mute">Not found.</div>
            </Route>
          </Switch>
        </Shell>
      </Router>
      </ToastHost>
    </MotionConfig>
  )
}
