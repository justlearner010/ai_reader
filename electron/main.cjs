const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const path = require("node:path");
const http = require("node:http");
const fs = require("node:fs/promises");

const DEFAULT_PORT = Number(process.env.AI_READER_PORT || 3000);
const HOST = "localhost";
const SHOULD_OPEN_DEVTOOLS = process.env.AI_READER_DEVTOOLS === "1";

let mainWindow = null;
let nextServer = null;
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

function sendCommand(command) {
  if (!mainWindow) return;
  mainWindow.webContents.send("ai-reader-command", command);
}

function booksRoot() {
  return path.join(app.getPath("userData"), "books");
}

function libraryRoot() {
  return path.join(app.getPath("userData"), "library");
}

function libraryStatePath() {
  return path.join(libraryRoot(), "library.json");
}

function safeBookDir(bookId) {
  const safeId = String(bookId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(booksRoot(), safeId);
}

function originalFileName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return `original${ext || ".book"}`;
}

async function fileToPayload(filePath) {
  const data = await fs.readFile(filePath);
  const stat = await fs.stat(filePath);
  return {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    lastModified: stat.mtimeMs,
    dataBase64: data.toString("base64"),
  };
}

function appUrl(port = DEFAULT_PORT) {
  return `http://${HOST}:${port}`;
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findOpenPort(startPort) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    const inUse = await ping(appUrl(port));
    if (!inUse) return port;
  }
  return startPort;
}

async function startNextServer() {
  if (!app.isPackaged) return DEFAULT_PORT;

  const port = await findOpenPort(DEFAULT_PORT);
  const next = require("next");
  const nextApp = next({
    dev: false,
    dir: app.getAppPath(),
    hostname: HOST,
    port,
  });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  nextServer = http.createServer((req, res) => handle(req, res));
  await new Promise((resolve, reject) => {
    nextServer.once("error", reject);
    nextServer.listen(port, HOST, resolve);
  });

  return port;
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "文件",
      submenu: [
        {
          label: "导入书籍...",
          accelerator: "CommandOrControl+O",
          click: () => sendCommand("import-book"),
        },
        {
          label: "返回书库",
          accelerator: "CommandOrControl+L",
          click: () => sendCommand("open-library"),
        },
        { type: "separator" },
        { role: "close", label: "关闭窗口" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
        { type: "separator" },
        {
          label: "搜索",
          accelerator: "CommandOrControl+F",
          click: () => sendCommand("focus-search"),
        },
        {
          label: "新建笔记",
          accelerator: "CommandOrControl+N",
          click: () => sendCommand("new-note"),
        },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新载入" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "进入全屏" },
        { type: "separator" },
        {
          label: "切换侧栏",
          accelerator: "CommandOrControl+B",
          click: () => sendCommand("toggle-sidebar"),
        },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放窗口" },
        { role: "togglefullscreen", label: "进入全屏" },
        { type: "separator" },
        { role: "close", label: "关闭窗口" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupIpc() {
  ipcMain.handle("library-load", async () => {
    try {
      const raw = await fs.readFile(libraryStatePath(), "utf8");
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === "ENOENT") return null;
      throw err;
    }
  });

  ipcMain.handle("library-save", async (_event, state) => {
    await fs.mkdir(libraryRoot(), { recursive: true });
    const targetPath = libraryStatePath();
    const tmpPath = `${targetPath}.tmp`;
    const payload = {
      ...state,
      version: 1,
      updatedAt: Date.now(),
    };
    await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tmpPath, targetPath);
    return { ok: true, path: targetPath };
  });

  ipcMain.handle("library-export-debug", async () => {
    const targetPath = libraryStatePath();
    try {
      const stat = await fs.stat(targetPath);
      return {
        path: targetPath,
        exists: true,
        size: stat.size,
        updatedAt: stat.mtimeMs,
      };
    } catch (err) {
      if (err && err.code === "ENOENT") {
        return { path: targetPath, exists: false };
      }
      throw err;
    }
  });

  ipcMain.handle("select-book-files", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "导入书籍",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Books", extensions: ["pdf", "epub", "txt"] },
      ],
    });

    if (result.canceled) return [];

    const files = [];
    for (const filePath of result.filePaths) {
      files.push(await fileToPayload(filePath));
    }
    return files;
  });

  ipcMain.handle("persist-book-file", async (_event, payload) => {
    const { bookId, name, sourcePath, dataBase64, fileHash } = payload || {};
    if (!bookId || !name) throw new Error("bookId and name are required");

    const dir = safeBookDir(bookId);
    await fs.mkdir(dir, { recursive: true });
    const storedName = originalFileName(name);
    const storedPath = path.join(dir, storedName);

    if (sourcePath) {
      await fs.copyFile(sourcePath, storedPath);
    } else if (dataBase64) {
      await fs.writeFile(storedPath, Buffer.from(dataBase64, "base64"));
    } else {
      throw new Error("sourcePath or dataBase64 is required");
    }

    const stat = await fs.stat(storedPath);
    const manifest = {
      version: 1,
      bookId,
      originalFileName: name,
      storedFileName: storedName,
      fileHash,
      size: stat.size,
      updatedAt: Date.now(),
    };
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    return {
      storage: "appData",
      originalFileName: name,
      filePath: storedPath,
      size: stat.size,
    };
  });

  ipcMain.handle("read-book-file", async (_event, payload) => {
    const { bookId, filePath } = payload || {};
    let targetPath = filePath || "";
    if (!targetPath && bookId) {
      const manifestPath = path.join(safeBookDir(bookId), "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      targetPath = path.join(safeBookDir(bookId), manifest.storedFileName);
    }
    if (!targetPath) throw new Error("bookId or filePath is required");
    const data = await fs.readFile(targetPath);
    const stat = await fs.stat(targetPath);
    return {
      name: path.basename(targetPath),
      size: stat.size,
      lastModified: stat.mtimeMs,
      dataBase64: data.toString("base64"),
    };
  });

  ipcMain.handle("delete-book-file", async (_event, payload) => {
    const { bookId } = payload || {};
    if (!bookId) return false;
    await fs.rm(safeBookDir(bookId), { recursive: true, force: true });
    return true;
  });
}

async function createWindow() {
  const port = app.isPackaged ? await startNextServer() : DEFAULT_PORT;

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    title: "AI Reader",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 14 },
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (SHOULD_OPEN_DEVTOOLS) mainWindow.webContents.openDevTools({ mode: "detach" });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const url = appUrl(port);
  try {
    await mainWindow.loadURL(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <!doctype html>
        <html lang="zh-CN">
          <head>
            <meta charset="utf-8" />
            <title>AI Reader 启动失败</title>
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                background: #0a0a0a;
                color: #e8e8e8;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              }
              main {
                max-width: 520px;
                padding: 32px;
                border: 1px solid #2a2a2a;
                border-radius: 12px;
                background: #111;
              }
              h1 { font-size: 18px; margin: 0 0 12px; }
              p { color: #aaa; line-height: 1.6; }
              code { color: #7dd3fc; }
            </style>
          </head>
          <body>
            <main>
              <h1>AI Reader 没有连上本地服务</h1>
              <p>请确认 Next 开发服务已经启动：<code>npm run dev</code>，然后重新打开桌面应用。</p>
              <p>目标地址：<code>${url}</code></p>
              <p>错误：${message}</p>
            </main>
          </body>
        </html>
      `)}`,
    );
    mainWindow.show();
  }
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

if (gotSingleInstanceLock) app.whenReady().then(async () => {
  app.name = "AI Reader";
  app.setAboutPanelOptions({
    applicationName: "AI Reader",
    applicationVersion: app.getVersion(),
    copyright: "Local-first AI reading workspace",
  });
  setupIpc();
  buildMenu();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (nextServer) nextServer.close();
});
