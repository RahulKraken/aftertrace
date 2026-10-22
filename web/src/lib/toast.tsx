import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

type Toast = { id: number; text: string }

const Ctx = createContext<(text: string) => void>(() => undefined)

let n = 0

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string) => {
    const id = ++n
    setItems((prev) => [...prev, { id, text }])
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2200)
  }, [])
  const value = useMemo(() => push, [push])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              className="toast"
              initial={{ opacity: 0, transform: "translateY(10px) scale(0.98)" }}
              animate={{ opacity: 1, transform: "translateY(0px) scale(1)", transition: { duration: 0.26, ease: [0.23, 1, 0.32, 1] } }}
              exit={{ opacity: 0, transform: "translateY(6px) scale(0.98)", transition: { duration: 0.16, ease: [0.23, 1, 0.32, 1] } }}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}

export function useToast() {
  return useContext(Ctx)
}
