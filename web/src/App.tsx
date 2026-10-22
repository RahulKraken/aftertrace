import { useEffect, useState } from "react"
import { MotionConfig } from "motion/react"
import { Route, Router, Switch } from "wouter"
import { useHashLocation } from "wouter/use-hash-location"
import { Shell } from "./components/Shell"
import { EmptyState } from "./components/EmptyState"
import { ToastHost } from "./lib/toast"
import { applyTheme, readTheme, switchTheme, type Theme } from "./lib/theme"
import { AppPage } from "./pages/AppPage"
import { AppsPage } from "./pages/AppsPage"
import { ConnectPage } from "./pages/ConnectPage"
import { CostPage } from "./pages/CostPage"
import { FindingsPage } from "./pages/FindingsPage"
import { HomePage } from "./pages/HomePage"
import { QueryPage } from "./pages/QueryPage"
import { RecapPage } from "./pages/RecapPage"
import { SessionPage } from "./pages/SessionPage"
import { SessionsPage } from "./pages/SessionsPage"
import { SettingsPage } from "./pages/SettingsPage"
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
        <Shell theme={theme} onTheme={(t) => switchTheme(t, setTheme)} mock={mock}>
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/sessions" component={SessionsPage} />
            <Route path="/apps" component={AppsPage} />
            <Route path="/apps/:service" component={AppPage} />
            <Route path="/recap" component={RecapPage} />
            <Route path="/connect" component={ConnectPage} />
            <Route path="/settings" component={SettingsPage} />
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
