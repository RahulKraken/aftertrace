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
})
