// Updates for the desktop app, from this repository's GitHub releases
// (electron-updater reads latest.yml, downloads the installer, checks its
// SHA-512, and runs it when Jobiza restarts).
//
// With automatic updates on (the default), Jobiza checks at start-up and every
// few hours, downloads new versions in the background and installs them the
// next time it quits. With them off, it only checks when asked.
const { app, Notification } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const CHECK_EVERY_MS = 4 * 60 * 60_000;
const FIRST_CHECK_DELAY_MS = 20_000;

let autoUpdater = null;
let settingsFile = null;
let settings = { autoUpdate: true };
let timer = null;
let log = () => {};
let onChange = () => {};
let beforeInstall = async () => {};

/** What the Settings page shows. */
const state = {
  version: app.getVersion(),
  auto: true,
  status: "idle", // idle | checking | latest | available | downloading | ready | error | unsupported
  latest: null,
  progress: null,
  notes: null,
  error: null,
  checkedAt: null,
};

function set(patch) {
  Object.assign(state, patch);
  onChange({ ...state });
}

function loadSettings() {
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };
  } catch {
    // first run: defaults
  }
  state.auto = settings.autoUpdate !== false;
}

function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

/** Release notes arrive as HTML or text depending on the source; the page shows plain text. */
function plainNotes(notes) {
  const text = Array.isArray(notes) ? notes.map((n) => n.note).join("\n\n") : notes;
  return typeof text === "string" ? text.replace(/<[^>]+>/g, "").trim().slice(0, 4000) : null;
}

function friendly(err) {
  const msg = String(err?.message ?? err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_|getaddrinfo/i.test(msg)) return "Couldn't reach GitHub. Check your internet connection.";
  if (/rate limit|403/i.test(msg)) return "GitHub is limiting requests right now. Jobiza will try again later.";
  if (/No published versions/i.test(msg)) return "No released version was found on GitHub yet.";
  if (/latest\.yml|404/i.test(msg)) return "No update information was found on GitHub for this version.";
  return "Couldn't check for updates. Jobiza will try again later.";
}

function setup(opts) {
  ({ log, onChange, beforeInstall } = { ...{ log, onChange, beforeInstall }, ...opts });
  settingsFile = path.join(app.getPath("userData"), "settings.json");
  loadSettings();

  // Installers only update installed apps; a development run or a Linux folder build can't.
  if (!app.isPackaged || process.platform !== "win32") {
    set({ status: "unsupported", error: "Updates work in the installed Windows app." });
    if (!process.env.JOBIZA_FORCE_UPDATER) return;
  }

  const updaterLib = require("electron-updater");
  // Tests on Linux can exercise the Windows updater's check and download (not the install).
  autoUpdater = process.platform === "win32" ? updaterLib.autoUpdater : new updaterLib.NsisUpdater();
  if (process.platform !== "win32") set({ status: "idle", error: null });
  autoUpdater.logger = { info: (m) => log(`[update] ${m}`), warn: (m) => log(`[update] ${m}`), error: (m) => log(`[update] ${m}`), debug: () => {} };
  autoUpdater.autoDownload = false; // decided per check, from the setting
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
  autoUpdater.on("update-not-available", () => set({ status: "latest", latest: state.version, checkedAt: new Date().toISOString() }));
  autoUpdater.on("update-available", (info) => {
    set({ status: "available", latest: info.version, notes: plainNotes(info.releaseNotes), checkedAt: new Date().toISOString() });
    if (state.auto) void download();
  });
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", progress: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => {
    set({ status: "ready", latest: info.version, progress: 100 });
    if (Notification.isSupported()) {
      const note = new Notification({ title: `Jobiza ${info.version} is ready`, body: "It installs when you close Jobiza. Click to restart and update now." });
      note.on("click", () => void install());
      note.show();
    }
  });
  autoUpdater.on("error", (err) => {
    log(`[update] error: ${err?.stack ?? err}`);
    set({ status: "error", error: friendly(err), progress: null });
  });

  schedule();
}

function schedule() {
  clearInterval(timer);
  timer = null;
  if (!autoUpdater || !state.auto) return;
  setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
  timer = setInterval(() => void check(), CHECK_EVERY_MS);
}

async function check() {
  if (!autoUpdater) return { ...state };
  if (state.status === "checking" || state.status === "downloading" || state.status === "ready") return { ...state };
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    set({ status: "error", error: friendly(err) });
  }
  return { ...state };
}

async function download() {
  if (!autoUpdater || state.status === "downloading" || state.status === "ready") return { ...state };
  try {
    set({ status: "downloading", progress: 0 });
    await autoUpdater.downloadUpdate();
  } catch (err) {
    set({ status: "error", error: friendly(err), progress: null });
  }
  return { ...state };
}

/** Restart into the new version: the server closes its database first. */
async function install() {
  if (!autoUpdater || state.status !== "ready") return { ...state };
  await beforeInstall();
  autoUpdater.quitAndInstall(false, true);
  return { ...state };
}

function setAuto(on) {
  settings.autoUpdate = Boolean(on);
  saveSettings();
  set({ auto: settings.autoUpdate });
  schedule();
  return { ...state };
}

module.exports = { setup, check, download, install, setAuto, getState: () => ({ ...state }) };
