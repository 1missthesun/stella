import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("security", {
  view: () => ipcRenderer.invoke("view"),
  onView: (cb: (v: unknown) => void) => {
    const h = (_e: unknown, v: unknown) => cb(v);
    ipcRenderer.on("view", h);
    return () => ipcRenderer.removeListener("view", h);
  },
  checkNow: () => ipcRenderer.invoke("check-now"),
  signIn: (how: unknown) => ipcRenderer.invoke("sign-in", how),
  connectEmail: () => ipcRenderer.invoke("connect-email"),
  disconnectEmail: () => ipcRenderer.invoke("disconnect-email"),
  fix: (id: string) => ipcRenderer.invoke("fix", id),
  snooze: (id: string) => ipcRenderer.invoke("snooze", id),
  openUrl: (url: string) => ipcRenderer.invoke("open-url", url),
  signOut: () => ipcRenderer.invoke("sign-out"),
});
