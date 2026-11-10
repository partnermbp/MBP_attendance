const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mbpDesktopDevice", Object.freeze({
  getInfo: () => ipcRenderer.invoke("mbp-device-info")
}));
