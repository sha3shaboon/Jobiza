// Jobiza desktop: runs the full app on this computer. The Next.js server runs
// in a utility process with an embedded database; this window talks to it
// over 127.0.0.1 on a random port. Only Claude and paper searches go online.
const { app, BrowserWindow, Menu, Notification, dialog, ipcMain, safeStorage, session, shell, utilityProcess } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const updater = require("./updater.cjs");

const isPackaged = app.isPackaged;
const resources = isPackaged ? process.resourcesPath : path.join(__dirname, "build");
const SERVER_DIR = path.join(resources, "server");
const MODELS_DIR = path.join(resources, "models");

// Tests point the app at a throwaway profile; normally this is %APPDATA%\Jobiza.
if (process.env.JOBIZA_USER_DATA) app.setPath("userData", path.resolve(process.env.JOBIZA_USER_DATA));
const userData = app.getPath("userData");
const DATA_DIR = path.join(userData, "library");
const LOG_DIR = path.join(userData, "logs");
const SECRETS_FILE = path.join(userData, "secrets.json");
const WINDOW_FILE = path.join(userData, "window.json");

let server = null;
let serverUrl = null;
let launchToken = null;
let mainWindow = null;
let splash = null;
let quitting = false;

/* ───────────── Secrets ───────────── */

/**
 * Random keys made on first run: the auth secret, the key that encrypts the
 * Anthropic API key at rest, and the local account's password. Stored with the
 * OS keystore (DPAPI on Windows) when it's available.
 */
function loadSecrets() {
  const fresh = () => ({
    authSecret: crypto.randomBytes(32).toString("base64"),
    encryptionKey: crypto.randomBytes(32).toString("base64"),
    localPassword: crypto.randomBytes(32).toString("hex"),
  });
  if (fs.existsSync(SECRETS_FILE)) {
    try {
      const file = JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8"));
      const json = file.encrypted ? safeStorage.decryptString(Buffer.from(file.data, "base64")) : file.data;
      return JSON.parse(json);
    } catch (err) {
      // Without the old encryption key, saved Anthropic keys can't be read; the user re-enters theirs.
      log(`[desktop] secrets unreadable, making new ones: ${err.message}`);
      fs.copyFileSync(SECRETS_FILE, `${SECRETS_FILE}.unreadable-${Date.now()}`);
    }
  }
  const secrets = fresh();
  const json = JSON.stringify(secrets);
  const encrypted = safeStorage.isEncryptionAvailable();
  const data = encrypted ? safeStorage.encryptString(json).toString("base64") : json;
  fs.writeFileSync(SECRETS_FILE, JSON.stringify({ version: 1, encrypted, data }), { mode: 0o600 });
  return secrets;
}

/* ───────────── Logs ───────────── */

let logStream = null;
function log(line) {
  if (!logStream) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const file = path.join(LOG_DIR, "jobiza.log");
    // Keep one previous log; start fresh past 5 MB.
    if (fs.existsSync(file) && fs.statSync(file).size > 5e6) fs.renameSync(file, `${file}.old`);
    logStream = fs.createWriteStream(file, { flags: "a" });
  }
  logStream.write(`${new Date().toISOString()} ${line.endsWith("\n") ? line : `${line}\n`}`);
}

/* ───────────── Server process ───────────── */

/** "ada.lovelace" → "Ada": the greeting uses the first name only. */
function displayName() {
  const first = (os.userInfo().username || "").split(/[._\s-]/)[0];
  return first ? first[0].toUpperCase() + first.slice(1) : "You";
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const secrets = loadSecrets();
  const port = await freePort();
  launchToken = crypto.randomBytes(32).toString("hex");
  serverUrl = `http://127.0.0.1:${port}`;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NEXT_TELEMETRY_DISABLED: "1",
    JOBIZA_DESKTOP: "1",
    JOBIZA_DATA_DIR: DATA_DIR,
    JOBIZA_LAUNCH_TOKEN: launchToken,
    JOBIZA_LOCAL_PASSWORD: secrets.localPassword,
    JOBIZA_LOCAL_NAME: displayName(),
    // How this computer appears to paired devices (renamable in Settings).
    JOBIZA_DEVICE_NAME: displayName() === "You" ? "This computer" : `${displayName()}'s computer`,
    BETTER_AUTH_SECRET: secrets.authSecret,
    BETTER_AUTH_URL: serverUrl,
    ENCRYPTION_KEY: secrets.encryptionKey,
    UPLOAD_DIR: path.join(DATA_DIR, "uploads"),
    MODEL_CACHE_DIR: MODELS_DIR,
  };
  delete env.DATABASE_URL;
  delete env.ELECTRON_RUN_AS_NODE;

  log(`[desktop] starting server on ${serverUrl}`);
  server = utilityProcess.fork(path.join(SERVER_DIR, "server-entry.cjs"), [], {
    cwd: SERVER_DIR,
    env,
    stdio: "pipe",
    serviceName: "Jobiza server",
  });
  server.stdout?.on("data", (d) => log(String(d)));
  server.stderr?.on("data", (d) => log(String(d)));
  server.on("exit", (code) => {
    log(`[desktop] server exited with code ${code}`);
    server = null;
    if (!quitting) void serverCrashed(code);
  });
  await waitForServer();
}

/** Ready once the sign-in route answers (it refuses a request without the launch token). */
async function waitForServer() {
  const deadline = Date.now() + 120_000; // first run applies migrations
  while (Date.now() < deadline) {
    if (!server) throw new Error("The Jobiza server stopped while starting.");
    try {
      const res = await fetch(`${serverUrl}/api/desktop/session`, { redirect: "manual" });
      if (res.status === 403) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The Jobiza server took too long to start.");
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const proc = server;
    const timer = setTimeout(() => {
      proc.kill();
      resolve();
    }, 8000);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    proc.postMessage("shutdown");
  });
}

async function serverCrashed(code) {
  const { response } = await dialog.showMessageBox({
    type: "error",
    title: "Jobiza stopped",
    message: "Jobiza's engine stopped unexpectedly.",
    detail: `Your library is saved. Restart to carry on. (Exit code ${code}. Details are in ${path.join(LOG_DIR, "jobiza.log")}.)`,
    buttons: ["Restart", "Open log", "Quit"],
    defaultId: 0,
  });
  if (response === 1) await shell.openPath(path.join(LOG_DIR, "jobiza.log"));
  if (response === 0) {
    app.relaunch();
  }
  quitting = true;
  app.quit();
}

/* ───────────── Windows ───────────── */

function sessionUrl(next = "/app") {
  return `${serverUrl}/api/desktop/session?${new URLSearchParams({ token: launchToken, next })}`;
}

function isAppUrl(url) {
  try {
    return new URL(url).origin === new URL(serverUrl).origin;
  } catch {
    return false;
  }
}

function showSplash() {
  splash = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: "#183021",
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, "splash.html"));
  splash.once("ready-to-show", () => splash?.show());
}

function readBounds() {
  try {
    return JSON.parse(fs.readFileSync(WINDOW_FILE, "utf8"));
  } catch {
    return { width: 1320, height: 880 };
  }
}

function createMainWindow() {
  const bounds = readBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: "Jobiza",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "build-resources", "icon.png"),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // Exposes only window.jobizaUpdates (see preload.cjs).
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  if (bounds.maximized) mainWindow.maximize();

  const wc = mainWindow.webContents;

  // Links to other sites open in the default browser; the app stays in this window.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) wc.loadURL(url);
    else if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });

  // There's no sign-in on desktop: if the app ever lands there, sign the window in again.
  const resignIn = (url) => {
    if (!isAppUrl(url)) return;
    const { pathname } = new URL(url);
    if (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) wc.loadURL(sessionUrl());
  };
  wc.on("did-navigate", (_e, url) => resignIn(url));
  wc.on("did-navigate-in-page", (_e, url) => resignIn(url));

  // Spell-check suggestions and the usual edit commands on right-click.
  wc.on("context-menu", (_e, params) => {
    const items = params.dictionarySuggestions.slice(0, 5).map((word) => ({ label: word, click: () => wc.replaceMisspelling(word) }));
    if (params.misspelledWord) {
      if (!items.length) items.push({ label: "No suggestions", enabled: false });
      items.push({ label: "Add to dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: "separator" });
    }
    if (params.isEditable) items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" });
    else if (params.selectionText) items.push({ role: "copy" });
    if (params.linkURL && !isAppUrl(params.linkURL)) items.push({ label: "Open link in browser", click: () => shell.openExternal(params.linkURL) });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });

  const saveBounds = () => {
    if (!mainWindow || mainWindow.isMinimized()) return;
    const state = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() };
    fs.writeFileSync(WINDOW_FILE, JSON.stringify(state));
  };
  mainWindow.on("close", saveBounds);
  mainWindow.on("closed", () => (mainWindow = null));
  mainWindow.once("ready-to-show", () => {
    splash?.destroy();
    splash = null;
    mainWindow.show();
  });

  mainWindow.loadURL(sessionUrl());
}

/* ───────────── Exports (downloads) ───────────── */

const FILE_TYPES = {
  docx: "Word document",
  pdf: "PDF document",
  zip: "LaTeX project (zip)",
  md: "Markdown",
  bib: "BibTeX references",
  csv: "Spreadsheet (CSV)",
};
let lastExportFolder = null;

/**
 * Exports arrive as downloads. Electron's built-in Save dialog can offer the wrong
 * file type on Windows, so the app asks where to save itself, with the right
 * name and type, and says when the file is saved.
 */
function handleDownloads() {
  session.defaultSession.on("will-download", (_event, item) => {
    const name = item.getFilename();
    const ext = path.extname(name).slice(1).toLowerCase();
    const folder = lastExportFolder ?? app.getPath("downloads");
    const target = dialog.showSaveDialogSync(mainWindow ?? undefined, {
      title: "Save export",
      defaultPath: path.join(folder, name),
      filters: [...(FILE_TYPES[ext] ? [{ name: FILE_TYPES[ext], extensions: [ext] }] : []), { name: "All files", extensions: ["*"] }],
    });
    if (!target) {
      item.cancel();
      return;
    }
    // Keep the extension even if it was deleted from the name in the dialog.
    const savePath = ext && !target.toLowerCase().endsWith(`.${ext}`) ? `${target}.${ext}` : target;
    lastExportFolder = path.dirname(savePath);
    item.setSavePath(savePath);
    item.once("done", (_e, state) => {
      if (state === "completed") {
        log(`[desktop] saved export ${savePath}`);
        if (Notification.isSupported()) {
          const note = new Notification({ title: "Export saved", body: `${path.basename(savePath)} is in ${path.dirname(savePath)}. Click to show it.` });
          note.on("click", () => shell.showItemInFolder(savePath));
          note.show();
        } else {
          shell.showItemInFolder(savePath);
        }
      } else if (state !== "cancelled") {
        log(`[desktop] export failed (${state}): ${savePath}`);
        dialog.showErrorBox("Couldn't save the export", `${path.basename(savePath)} couldn't be saved (${state}). Check that the folder exists and you can write to it, then try again.`);
      }
    });
  });
}

/* ───────────── Updates ───────────── */

/** Only Jobiza's own pages may use the update controls. */
function fromApp(event) {
  return Boolean(serverUrl) && isAppUrl(event.senderFrame?.url ?? "");
}

function setupUpdates() {
  updater.setup({
    log,
    onChange: (state) => mainWindow?.webContents.send("updates:state", state),
    // Close the database cleanly before the installer replaces the app.
    beforeInstall: async () => {
      quitting = true;
      await stopServer();
    },
  });
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromApp(event)) throw new Error("Not allowed");
      return fn(...args);
    });
  handle("updates:get", () => updater.getState());
  handle("updates:check", () => updater.check());
  handle("updates:download", () => updater.download());
  handle("updates:install", () => updater.install());
  handle("updates:set-auto", (on) => updater.setAuto(on));
}

async function checkFromMenu() {
  const state = await updater.check();
  const done = () => updater.getState();
  // Wait for the check to settle, then say what happened.
  for (let i = 0; i < 60 && done().status === "checking"; i++) await new Promise((r) => setTimeout(r, 500));
  const s = done();
  const message =
    s.status === "unsupported"
      ? s.error
      : s.status === "latest"
        ? `You have the latest version (${s.version}).`
        : s.status === "error"
          ? s.error
          : s.status === "ready"
            ? `Jobiza ${s.latest} is ready. It installs when you close Jobiza.`
            : `Jobiza ${s.latest ?? state.latest} is available. ${s.auto ? "It's downloading now." : "Download it from Settings, Updates."}`;
  await dialog.showMessageBox(mainWindow ?? undefined, { type: "info", title: "Updates", message: message ?? "Couldn't check for updates." });
}

function buildMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { label: "&File", submenu: [process.platform === "darwin" ? { role: "close" } : { role: "quit", label: "E&xit" }] },
    { role: "editMenu" },
    {
      label: "&View",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isPackaged ? [] : [{ role: "toggleDevTools" }]),
      ],
    },
    {
      label: "&Help",
      submenu: [
        { label: "Show library folder", click: () => shell.openPath(DATA_DIR) },
        { label: "Show log file", click: () => shell.openPath(path.join(LOG_DIR, "jobiza.log")) },
        { label: "Check for updates…", click: () => void checkFromMenu() },
        { type: "separator" },
        { label: `Jobiza ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ───────────── App lifecycle ───────────── */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("app.jobiza.desktop");

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    handleDownloads();
    setupUpdates();
    showSplash();
    try {
      await startServer();
      createMainWindow();
    } catch (err) {
      log(`[desktop] failed to start: ${err.stack ?? err}`);
      splash?.destroy();
      dialog.showErrorBox("Jobiza couldn't start", `${err.message}\n\nDetails are in ${path.join(LOG_DIR, "jobiza.log")}.`);
      quitting = true;
      await stopServer();
      app.exit(1);
    }
  });

  app.on("activate", () => {
    if (!mainWindow && serverUrl) createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // Let the server close its database cleanly before the app exits.
  app.on("before-quit", (e) => {
    if (!server) return;
    e.preventDefault();
    quitting = true;
    void stopServer().then(() => app.quit());
  });
}
