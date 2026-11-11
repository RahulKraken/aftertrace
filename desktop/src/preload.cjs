"use strict"

const { contextBridge, ipcRenderer } = require("electron")

function windowKind() {
  const arg = (process.argv || []).find((a) => String(a).startsWith("--aftertrace-window="))
  return arg === "--aftertrace-window=settings" ? "settings" : "dashboard"
}

contextBridge.exposeInMainWorld("aftertraceDesktop", {
  platform: process.platform,
  windowKind: windowKind(),
  getOpenAtLogin: () => ipcRenderer.invoke("desktop:getOpenAtLogin"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("desktop:setOpenAtLogin", Boolean(enabled)),
  continueToApp: () => ipcRenderer.invoke("desktop:continue"),
  engineStatus: () => ipcRenderer.invoke("desktop:engineStatus"),
  fixForeignEngine: () => ipcRenderer.invoke("desktop:fixForeignEngine"),
  onEngineStatus: (fn) => {
    const wrapped = (_e, status) => fn(status)
    ipcRenderer.on("desktop:engine-status", wrapped)
    return () => ipcRenderer.removeListener("desktop:engine-status", wrapped)
  },
  getGlance: () => ipcRenderer.invoke("desktop:getGlance"),
  getUpdate: () => ipcRenderer.invoke("desktop:getUpdate"),
  openDashboard: (hash) => ipcRenderer.invoke("desktop:openDashboard", hash),
  openSettings: (hash) => ipcRenderer.invoke("desktop:openSettings", hash),
  getAccentColor: () => ipcRenderer.invoke("desktop:getAccentColor"),
  onAccentColor: (fn) => {
    const wrapped = (_e, hex) => fn(hex)
    ipcRenderer.on("desktop:accent", wrapped)
    return () => ipcRenderer.removeListener("desktop:accent", wrapped)
  },
  checkUpdates: () => ipcRenderer.invoke("desktop:checkUpdates"),
  restartToUpdate: () => ipcRenderer.invoke("desktop:restartToUpdate"),
  quitApp: () => ipcRenderer.invoke("desktop:quit"),
  onGlance: (fn) => {
    const wrapped = (_e, data) => fn(data)
    ipcRenderer.on("desktop:glance", wrapped)
    return () => ipcRenderer.removeListener("desktop:glance", wrapped)
  },
  onUpdate: (fn) => {
    const wrapped = (_e, data) => fn(data)
    ipcRenderer.on("desktop:update", wrapped)
    return () => ipcRenderer.removeListener("desktop:update", wrapped)
  },
})
