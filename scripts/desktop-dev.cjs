const { spawn } = require("node:child_process");
const http = require("node:http");

const PORT = Number(process.env.AI_READER_PORT || 3000);
const HOST = "localhost";
const URL = `http://${HOST}:${PORT}`;

const children = new Set();

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
      AI_READER_PORT: String(PORT),
      ...options.env,
    },
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function stopAll(signal = "SIGTERM") {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

function ping() {
  return new Promise((resolve) => {
    const req = http.get(URL, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await ping()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  let nextProcess = null;
  if (await ping()) {
    console.log(`[desktop] Reusing existing Next dev server at ${URL}`);
  } else {
    console.log(`[desktop] Starting Next dev server at ${URL}`);
    nextProcess = run("npx", ["next", "dev", "-p", String(PORT)]);
    const ready = await waitForServer();
    if (!ready) {
      stopAll();
      throw new Error(`Next dev server did not become ready at ${URL}`);
    }
  }

  console.log("[desktop] Starting Electron");
  const electronProcess = run("npx", ["electron", "."]);
  electronProcess.once("exit", (code, signal) => {
    if (nextProcess) stopAll();
    process.exit(code ?? (signal ? 1 : 0));
  });
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(143);
});

main().catch((error) => {
  console.error(`[desktop] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
