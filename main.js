"use strict";
// 主进程。本文件可能来自安装包内置的 app.asar，也可能来自 <userData>/updates/ 里下载的新应用层；
// 所有资源路径都相对本文件的 __dirname，自然落在当前应用层里。
//
// 命令行参数：
//   --no-updates   不加载已下载的应用层，也不自动检查更新（由启动器处理加载部分）
//   --app-gpu      macOS 上恢复显卡加速（默认关闭，见下）
//   --smoke-test   CI 冒烟测试：打开窗口、检查页面和预加载接口后退出（退出码 0 = 通过）
const { app, BrowserWindow, ipcMain, shell, net } = require("electron");
const path = require("path");
const fs = require("fs");
const { loadConfig } = require("./lib/config");
const { createUpdater } = require("./lib/updater");
const core = require("./lib/update-core");

const config = loadConfig(__dirname);
const TIMEOUT_MS = 25000; // 所有页面加载 / 网络请求的超时上限
const SMOKE = process.argv.includes("--smoke-test");
const NO_UPDATES = process.argv.includes("--no-updates") || process.env.APP_NO_UPDATES === "1";

// 部分 Mac 上 Chromium 的 ANGLE Metal 后端编译着色器失败（日志里是 "Function main0 was not found"），
// 窗口一直黑屏不出画面。默认关掉硬件加速改用软件合成（必须在 app ready 之前调用）；
// 需要显卡加速（WebGL、大量动画）时加 --app-gpu 启动。
if (process.platform === "darwin" && !process.argv.includes("--app-gpu") && !app.isReady()) {
  try { app.disableHardwareAcceleration(); } catch { /* ignore */ }
}

// ---------------- 应用层信息（由 boot/bootstrap.js 提供；直接 electron main.js 运行时用兜底值） ----------------
const LAYER_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version; } catch { return app.getVersion(); } })();
const BOOT = global.__appBoot || {
  protocol: core.BOOT_PROTOCOL, version: LAYER_VERSION, bundledVersion: LAYER_VERSION, source: "bundled", electron: process.versions.electron,
  updatesDir: path.join(app.getPath("userData"), "updates"), rejected: [],
  markReady() {}, markGood() {}, cancelLaunch() {}, fail() {},
};

// 带超时的 Promise：超时后 reject（用于页面加载、executeJavaScript 等）
function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}超时（${Math.round(ms / 1000)} 秒）`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

// net.fetch（走系统代理）+ 25 秒内必须拿到响应头；拿到后不限制下载时长（下载器自己有卡顿检测）
function timedFetch(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, ctl.signal]) : ctl.signal;
  return net.fetch(url, { ...opts, signal }).finally(() => clearTimeout(t));
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
  }
}

// ---------------- 单实例 ----------------
const gotLock = SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  BOOT.cancelLaunch();
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) createWindow();
    else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 520,
    minHeight: 420,
    title: config.productName,
    show: false, // 先隐藏，画好第一帧再显示，避免白屏闪烁
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const win = mainWindow;
  // ready-to-show 偶尔不来（GPU/合成问题）：3 秒后兜底显示，再强制重绘一次
  let revealed = false;
  const reveal = () => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    if (SMOKE) return; // 冒烟测试不弹窗
    win.show(); win.focus();
    setTimeout(() => { if (!win.isDestroyed()) { try { win.webContents.invalidate(); } catch { /* ignore */ } } }, 120);
  };
  win.once("ready-to-show", reveal);
  setTimeout(reveal, 3000);
  win.on("closed", () => { if (mainWindow === win) mainWindow = null; });
  win.webContents.once("did-finish-load", () => BOOT.markReady());
  // 外部链接一律交给系统浏览器，且只放行 https
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) e.preventDefault(); });
  return withTimeout(win.loadFile(path.join(__dirname, "renderer", "index.html")), TIMEOUT_MS, "页面加载")
    .catch((err) => { console.error("[main] " + err.message); });
}

// ---------------- 应用内增量更新 ----------------
const ofs = (() => { try { return require("original-fs"); } catch { return fs; } })(); // .asar 当普通文件写
const updater = createUpdater({ fetchImpl: timedFetch, fsImpl: ofs, boot: BOOT, config });
let lastCheck = null;

function stripManifest(r) { if (!r) return r; const { manifest, ...rest } = r; return rest; }

async function checkUpdate({ auto } = {}) {
  const r = await updater.check();
  lastCheck = r;
  broadcast("update:status", { phase: "checked", result: stripManifest(r) });
  // 启动后自动检查：有可增量更新的新版本就直接在后台下载，下载完界面提示「重启生效」
  if (auto && r.ok && r.available && !r.needsFull && !r.badBefore && !r.alreadyDownloaded) await downloadUpdate(r.manifest);
  return r;
}
async function downloadUpdate(manifest) {
  broadcast("update:progress", { pct: 0, received: 0, total: manifest.size, source: "" });
  const r = await updater.download(manifest, (p) => broadcast("update:progress", p));
  broadcast("update:status", { phase: r.ok ? "downloaded" : "error", result: r });
  return r;
}

ipcMain.handle("app:info", () => ({ ...updater.info(), platform: process.platform, arch: process.arch }));
ipcMain.handle("update:info", () => ({ ...updater.info(), lastCheck: stripManifest(lastCheck), downloading: updater.downloading }));
ipcMain.handle("update:check", async () => stripManifest(await checkUpdate({ auto: false })));
ipcMain.handle("update:download", async () => {
  if (!lastCheck || !lastCheck.ok || !lastCheck.available) await checkUpdate({ auto: false });
  if (!lastCheck || !lastCheck.ok) return { ok: false, error: (lastCheck && lastCheck.error) || "检查更新失败", message: (lastCheck && lastCheck.message) || "检查更新失败" };
  if (!lastCheck.available) return { ok: false, error: "已是最新版本", message: "已是最新版本" };
  if (lastCheck.needsFull) return { ok: false, needsFull: true, installerUrl: lastCheck.installerUrl, error: "需要下载完整安装包", message: "这个版本需要下载完整安装包" };
  return downloadUpdate(lastCheck.manifest);
});
ipcMain.handle("update:restart", () => { app.relaunch(); app.exit(0); return true; });
ipcMain.handle("update:openUrl", (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(String(url)); return true; });

// ---------------- CI 冒烟测试 ----------------
function runSmokeTest() {
  const errors = [];
  const hardStop = setTimeout(() => { console.log("SMOKE TIMEOUT"); app.exit(2); }, 60000);
  mainWindow.webContents.on("console-message", (_e, level, message) => { if (level >= 3) errors.push(message); });
  const run = async () => {
    const out = await withTimeout(mainWindow.webContents.executeJavaScript(`(async () => {
      const a = window.app;
      const info = await a.info();
      const upd = await a.update.info();
      await new Promise((r) => setTimeout(r, 500));
      return {
        api: typeof a === "object" && typeof a.update.check === "function",
        nodeHidden: typeof require === "undefined" && typeof process === "undefined",
        name: document.getElementById("app-name").textContent.trim(),
        version: document.getElementById("app-version").textContent.trim(),
        card: !!document.getElementById("update-card"),
        info, source: upd.source,
      };
    })()`, true), TIMEOUT_MS, "页面脚本");
    const result = { ...out, layerVersion: LAYER_VERSION, boot: { source: BOOT.source, version: BOOT.version, bundled: BOOT.bundledVersion, electron: BOOT.electron }, platform: process.platform, rendererErrors: errors };
    const ok = out.api && out.nodeHidden && out.card && out.name === config.productName && out.version.includes(LAYER_VERSION) && !errors.length;
    console.log((ok ? "SMOKE OK " : "SMOKE FAIL ") + JSON.stringify(result));
    clearTimeout(hardStop);
    BOOT.markGood();
    app.exit(ok ? 0 : 1);
  };
  const go = () => run().catch((err) => { console.log("SMOKE FAIL " + ((err && err.stack) || err)); app.exit(1); });
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once("did-finish-load", go); else go();
}

// ---------------- 启动 ----------------
if (gotLock) {
  app.whenReady().then(() => {
    createWindow();
    if (SMOKE) { runSmokeTest(); return; }
    if (!NO_UPDATES) setTimeout(() => { checkUpdate({ auto: true }).catch(() => {}); }, 6000);
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  // macOS 习惯：关掉窗口应用仍留在 Dock；其他系统直接退出
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
