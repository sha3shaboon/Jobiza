// Gives Jobiza's pages (served by the app's own server) a small, fixed set of
// desktop features. Nothing else from Electron or Node is exposed.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jobizaUpdates", {
  platform: "desktop",
  getState: () => ipcRenderer.invoke("updates:get"),
  check: () => ipcRenderer.invoke("updates:check"),
  download: () => ipcRenderer.invoke("updates:download"),
  install: () => ipcRenderer.invoke("updates:install"),
  setAuto: (on) => ipcRenderer.invoke("updates:set-auto", Boolean(on)),
  onChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("updates:state", listener);
    return () => ipcRenderer.removeListener("updates:state", listener);
  },
});
