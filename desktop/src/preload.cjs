"use strict"

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("aftertraceDesktop", {
  platform: process.platform,
  getOpenAtLogin: () => ipcRenderer.invoke("desktop:getOpenAtLogin"),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke("desktop:setOpenAtLogin", Boolean(enabled)),
  continueToApp: () => ipcRenderer.invoke("desktop:continue"),
  engineStatus: () => ipcRenderer.invoke("desktop:engineStatus"),
  onEngineStatus: (fn) => {
    const wrapped = (_e, status) => fn(status)
    ipcRenderer.on("desktop:engine-status", wrapped)
    return () => ipcRenderer.removeListener("desktop:engine-status", wrapped)
  },
  getGlance: () => ipcRenderer.invoke("desktop:getGlance"),
  getUpdate: () => ipcRenderer.invoke("desktop:getUpdate"),
  openDashboard: (hash) => ipcRenderer.invoke("desktop:openDashboard", hash),
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
