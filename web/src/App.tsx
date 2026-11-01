import { useEffect, useState } from "react"
import { MotionConfig } from "motion/react"
import { Route, Router, Switch } from "wouter"
import { Shell } from "./components/Shell"
import { EmptyState } from "./components/EmptyState"
import { ToastHost } from "./lib/toast"
import { applyTheme, readTheme, switchTheme, type Theme } from "./lib/theme"
import { HashRedirect, hashHrefs, useHashPath } from "./lib/hash"
import { AppPage } from "./pages/AppPage"
import { FindingsPage } from "./pages/FindingsPage"
import { HomePage } from "./pages/HomePage"
import { RecapPage } from "./pages/RecapPage"
import { SessionPage } from "./pages/SessionPage"
import { SessionsPage } from "./pages/SessionsPage"
import { SettingsPage } from "./pages/SettingsPage"
import { TracePage } from "./pages/TracePage"

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const mock = import.meta.env.VITE_USE_MOCK !== "0"

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <MotionConfig reducedMotion="user">
      <ToastHost>
      <Router hook={useHashPath} hrefs={hashHrefs}>
        <Shell theme={theme} onTheme={(t) => switchTheme(t, setTheme)} mock={mock}>
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/sessions" component={SessionsPage} />
            <Route path="/apps/:service" component={AppPage} />
            <Route path="/apps">
              <HashRedirect to="/sessions" set={{ src: "apps" }} />
            </Route>
            <Route path="/recap" component={RecapPage} />
            <Route path="/connect">
              <HashRedirect to="/settings" set={{ tab: "sources" }} />
            </Route>
            <Route path="/settings" component={SettingsPage} />
            <Route path="/session/:id" component={SessionPage} />
            <Route path="/trace/:id" component={TracePage} />
            <Route path="/findings" component={FindingsPage} />
            <Route path="/query">
              <HashRedirect to="/settings" set={{ tab: "query" }} remap={{ tab: "view" }} />
            </Route>
            <Route path="/cost">
              <HashRedirect to="/recap" />
            </Route>
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
