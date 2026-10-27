"use strict";
// 示例页面：显示应用名、版本、来源，以及「应用更新」卡片。只通过 window.app（preload 暴露）和主进程通信。
const $ = (id) => document.getElementById(id);
const api = window.app;

const ui = {
  status: $("update-status"), notes: $("update-notes"), error: $("update-error"),
  progress: $("update-progress"), bar: $("update-bar"),
  check: $("btn-check"), download: $("btn-download"), full: $("btn-full"), restart: $("btn-restart"),
};
let installerUrl = "";

function show(el, on) { el.hidden = !on; }
function mb(bytes) { return (bytes / 1048576).toFixed(1) + " MB"; }

function setError(res) {
  const msg = res && (res.message || res.error);
  ui.error.textContent = msg || "";
  ui.error.title = (res && res.detail) || ""; // 鼠标悬停可看原始错误
  show(ui.error, !!msg);
}

function renderCheck(r) {
  setError(null);
  show(ui.download, false); show(ui.full, false); show(ui.notes, false);
  if (!r) return;
  if (!r.ok) { ui.status.textContent = "检查更新没有成功"; setError(r); return; }
  if (r.alreadyDownloaded) { renderDownloaded(r.latest); return; }
  if (!r.available) { ui.status.textContent = `已是最新版本（${r.current}）`; return; }
  if (r.notes) { ui.notes.textContent = r.notes; show(ui.notes, true); }
  if (r.needsFull) {
    ui.status.textContent = `发现新版本 ${r.latest}，需要下载完整安装包（${r.fullReason}）`;
    installerUrl = r.installerUrl || r.releaseUrl || "";
    show(ui.full, !!installerUrl);
    return;
  }
  ui.status.textContent = `发现新版本 ${r.latest}（约 ${mb(r.size)}）`;
  if (r.badBefore) setError({ message: "这个版本上次启动失败，已自动退回。可以重新下载再试一次。", detail: r.badBefore });
  show(ui.download, true);
}

function renderDownloaded(version) {
  show(ui.progress, false); show(ui.download, false); show(ui.full, false);
  ui.status.textContent = `新版本 ${version} 已下载好，重启后生效`;
  show(ui.restart, true);
}

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

ui.check.addEventListener("click", () => busy(ui.check, "正在检查…", async () => {
  ui.status.textContent = "正在检查更新…";
  renderCheck(await api.update.check());
}));

ui.download.addEventListener("click", () => busy(ui.download, "正在下载…", async () => {
  setError(null);
  ui.bar.style.width = "0%"; show(ui.progress, true);
  ui.check.disabled = true;
  try {
    const r = await api.update.download();
    if (r.ok) renderDownloaded(r.version);
    else {
      show(ui.progress, false);
      if (r.needsFull) { installerUrl = r.installerUrl || ""; show(ui.full, !!installerUrl); show(ui.download, false); }
      setError(r);
    }
  } finally { ui.check.disabled = false; }
}));

ui.full.addEventListener("click", () => { if (installerUrl) api.update.openUrl(installerUrl); });
ui.restart.addEventListener("click", () => api.update.restart());

api.update.onProgress((p) => {
  show(ui.progress, true);
  ui.bar.style.width = (p.pct || 0) + "%";
  ui.status.textContent = p.total ? `正在下载… ${p.pct}%（${mb(p.received)} / ${mb(p.total)}）` : "正在下载…";
});
// 启动后台自动检查 / 自动下载的结果也同步到界面
api.update.onStatus((s) => {
  if (s.phase === "checked") renderCheck(s.result);
  else if (s.phase === "downloaded") renderDownloaded(s.result.version);
  else if (s.phase === "error") { show(ui.progress, false); setError(s.result); }
});

(async () => {
  const info = await api.info();
  document.title = info.productName;
  $("app-name").textContent = info.productName;
  $("app-version").textContent = "版本 " + info.version;
  const src = $("app-source");
  src.textContent = info.source === "update" ? "已更新" : "安装包内置";
  src.classList.toggle("update", info.source === "update");
  src.title = info.source === "update" ? `安装包版本 ${info.bundledVersion}` : "";
  show(src, true);
  if (!info.repoConfigured) {
    ui.status.textContent = "更新功能还没有配置";
    setError({ message: "请在 app.config.json 里把 repo 改成你的 GitHub 仓库" });
    ui.check.disabled = true;
    return;
  }
  const u = await api.update.info();
  if (u.downloaded) renderDownloaded(u.downloaded);
  else if (u.lastCheck) renderCheck(u.lastCheck);
})();
