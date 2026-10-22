import { createContext, useContext } from "react"
import type { Status } from "./types"

export const StatusContext = createContext<Status | null>(null)

// The server's live status: counts for the sidebar, and capture settings for
// Connect and Settings. The shell polls it every 5 seconds.
export function useStatus(): Status | null {
  return useContext(StatusContext)
}
