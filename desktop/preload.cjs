const { contextBridge } = require("electron");
const os = require("node:os");
const { app } = require("electron");

contextBridge.exposeInMainWorld("mbpDesktopDevice", Object.freeze({
  platform: process.platform,
  osVersion: os.release(),
  architecture: os.arch(),
  appVersion: app.getVersion()
}));
