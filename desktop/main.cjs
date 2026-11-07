const { app, BrowserWindow, shell, session } = require("electron");
const path = require("path");

const APP_URL = "https://attendence.dpdns.org/";

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    backgroundColor: "#03091F",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("https://attendence.dpdns.org/")) {
      event.preventDefault();
      if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
    }
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "geolocation" || permission === "notifications");
  });
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "geolocation" || permission === "notifications";
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
