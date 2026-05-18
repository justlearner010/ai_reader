const { contextBridge, ipcRenderer } = require("electron");

ipcRenderer.on("ai-reader-command", (_event, command) => {
  window.dispatchEvent(new CustomEvent("ai-reader-command", { detail: command }));
});

contextBridge.exposeInMainWorld("aiReaderDesktop", {
  platform: process.platform,
  isDesktop: true,
  selectBookFiles: () => ipcRenderer.invoke("select-book-files"),
  persistBookFile: (payload) => ipcRenderer.invoke("persist-book-file", payload),
  readBookFile: (payload) => ipcRenderer.invoke("read-book-file", payload),
  deleteBookFile: (payload) => ipcRenderer.invoke("delete-book-file", payload),
  loadLibraryState: () => ipcRenderer.invoke("library-load"),
  saveLibraryState: (state) => ipcRenderer.invoke("library-save", state),
  getLibraryStatePath: async () => {
    const debug = await ipcRenderer.invoke("library-export-debug");
    return debug.path;
  },
  onCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on("ai-reader-command", handler);
    return () => ipcRenderer.removeListener("ai-reader-command", handler);
  },
});
