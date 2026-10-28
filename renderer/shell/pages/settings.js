"use strict";
// 内置页面：设置。外观（深浅色、缩放、侧边栏）、通用（开机自启、自动检查更新）、应用更新、数据与日志、关于。
// 加自己的设置分组：
//   Shell.registerSettingsSection({ id: "sync", title: "同步", order: 15, render(box, ctx) { box.append(...) } });
// 设置项要先在 main.js 的 schema 里声明，读写用 Shell.getSettings() / Shell.saveSettings({ key: value })。
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const sections = [];

  window.Shell.registerSettingsSection = function (def) {
    if (!def || !def.id || typeof def.render !== "function") throw new Error("registerSettingsSection 需要 id 和 render");
    sections.push(def);
  };

  // ---- 通用控件 ----
  // 一行设置：左边标题 + 说明，右边控件
  function row(title, desc, control) {
    return h("div", { class: "set-row" },
      h("div", { class: "set-text" }, h("div", { class: "set-title" }, title), desc ? h("div", { class: "set-desc" }, desc) : null),
      h("div", { class: "set-control" }, control));
  }
  function toggle(key, { onChange } = {}) {
    const input = h("input", { type: "checkbox", role: "switch", checked: !!window.Shell.getSettings()[key],
      onchange: () => { window.Shell.saveSettings({ [key]: input.checked }); onChange && onChange(input.checked); } });
    window.Shell.onSettings((c, s) => { if (key in c) input.checked = !!s[key]; });
    return h("label", { class: "switch" }, input, h("span", { class: "slider" }));
  }
  function segmented(key, options) {
    const box = h("div", { class: "segmented", role: "radiogroup" });
    const draw = (v) => { for (const b of box.children) b.classList.toggle("active", b.dataset.value === v); };
    for (const [value, label] of options) {
      box.append(h("button", { dataset: { value }, role: "radio", onclick: () => { window.Shell.saveSettings({ [key]: value }); draw(value); } }, label));
    }
    draw(String(window.Shell.getSettings()[key]));
    window.Shell.onSettings((c, s) => { if (key in c) draw(String(s[key])); });
    return box;
  }
  function select(key, options, { parse = (v) => v } = {}) {
    const sel = h("select", { class: "input", onchange: () => window.Shell.saveSettings({ [key]: parse(sel.value) }) },
      ...options.map(([value, label]) => h("option", { value: String(value) }, label)));
    sel.value = String(window.Shell.getSettings()[key]);
    window.Shell.onSettings((c, s) => { if (key in c) sel.value = String(s[key]); });
    return sel;
  }
  window.Shell.settingsUI = { row, toggle, segmented, select };

  // ---- 应用更新卡片（元素 id 供冒烟测试检查） ----
  function updateCard(info) {
    const ui = {};
    ui.status = h("p", { class: "status", id: "update-status" }, "点击「检查更新」看看有没有新版本");
    ui.notes = h("p", { class: "notes", id: "update-notes", hidden: true });
    ui.bar = h("div", { class: "bar", id: "update-bar" });
    ui.progress = h("div", { class: "progress", id: "update-progress", hidden: true }, ui.bar);
    ui.error = h("p", { class: "error", id: "update-error", hidden: true });
    ui.check = h("button", { class: "btn", id: "btn-check" }, "检查更新");
    ui.download = h("button", { class: "btn primary", id: "btn-download", hidden: true }, "下载更新");
    ui.full = h("button", { class: "btn primary", id: "btn-full", hidden: true }, "下载完整安装包");
    ui.restart = h("button", { class: "btn primary", id: "btn-restart", hidden: true }, "重启生效");
    const card = h("div", { class: "card", id: "update-card" },
      ui.status, ui.notes, ui.progress, ui.error,
      h("div", { class: "actions" }, ui.check, ui.download, ui.full, ui.restart));

    let installerUrl = "";
    const show = (el, on) => { el.hidden = !on; };
    const mb = (b) => (b / 1048576).toFixed(1) + " MB";
    function setError(res) {
      const msg = res && (res.message || res.error);
      ui.error.textContent = msg || "";
      ui.error.title = (res && res.detail) || "";
      show(ui.error, !!msg);
    }
    function renderDownloaded(version) {
      show(ui.progress, false); show(ui.download, false); show(ui.full, false);
      ui.status.textContent = `新版本 ${version} 已下载好，重启后生效`;
      show(ui.restart, true);
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
    api.update.onStatus((s) => {
      if (s.phase === "checked") renderCheck(s.result);
      else if (s.phase === "downloaded") renderDownloaded(s.result.version);
      else if (s.phase === "error") { show(ui.progress, false); setError(s.result); }
    });
    (async () => {
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
    return card;
  }

  // ---- 内置分组 ----
  const builtin = [
    { id: "appearance", title: "外观", order: 10, render(box) {
      box.append(
        row("主题", "跟随系统会随系统的深浅色自动切换", segmented("theme", [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]])),
        row("界面缩放", "调整所有文字和控件的大小", select("zoom", [[0.8, "80%"], [0.9, "90%"], [1, "100%"], [1.1, "110%"], [1.25, "125%"], [1.5, "150%"]], { parse: Number })),
        row("折叠侧边栏", "只显示图标。也可以按 Ctrl/⌘ + B，或双击侧边栏边缘", toggle("sidebarCollapsed")));
    } },
    { id: "general", title: "通用", order: 20, render(box, ctx) {
      if (ctx.system.canOpenAtLogin) box.append(row("开机自动启动", "登录系统后自动打开应用", toggle("openAtLogin")));
      box.append(row("自动检查更新", "启动后在后台检查，有新版本自动下载，重启生效", toggle("autoCheckUpdate")));
    } },
    { id: "update", title: "应用更新", order: 30, render(box, ctx) { box.append(updateCard(ctx.info)); } },
    { id: "data", title: "数据与日志", order: 40, render(box, ctx) {
      box.append(
        row("数据目录", ctx.system.dataDir, h("button", { class: "btn", onclick: () => api.system.openDataDir() }, "打开")),
        row("日志级别", "「调试」会记录更多细节，排查问题时再打开", select("logLevel", [["debug", "调试"], ["info", "信息"], ["warn", "警告"], ["error", "错误"]])),
        row("日志文件", "按天保存，保留 7 天", h("button", { class: "btn", onclick: () => api.logs.openDir() }, "打开文件夹")),
        row("清除缓存", "清掉网页缓存，不影响设置和数据", h("button", { class: "btn", onclick: async () => {
          const r = await api.system.clearCache();
          window.Shell.toast(r.ok ? "缓存已清除" : "清除失败：" + r.error, r.ok ? "success" : "error");
        } }, "清除")),
        row("恢复默认设置", "所有设置回到初始值（不删除数据）", h("button", { class: "btn danger-ghost", onclick: async () => {
          if (!(await window.Shell.confirm("确定把所有设置恢复为默认值吗？", { okText: "恢复默认", danger: true }))) return;
          await api.settings.reset();
          window.Shell.toast("已恢复默认设置", "success");
        } }, "恢复默认")));
    } },
    { id: "about", title: "关于", order: 90, render(box, ctx) {
      const i = ctx.info, s = ctx.system;
      const kv = (k, v) => h("div", { class: "kv" }, h("span", { class: "muted" }, k), h("span", { class: "mono" }, v));
      box.append(h("div", { class: "card kv-list" },
        kv("应用", i.productName),
        kv("版本", `${i.version}（${i.source === "update" ? `已更新，安装包 ${i.bundledVersion}` : "安装包内置"}）`),
        kv("Electron", s.versions.electron), kv("Chromium", s.versions.chrome), kv("Node.js", s.versions.node),
        kv("系统", `${s.platform}-${s.arch}`),
        i.repoConfigured ? kv("仓库", i.repo) : null));
    } },
  ];

  window.Shell.registerPage({
    id: "settings", title: "设置", icon: "settings", section: "system", order: 30,
    async render(root, ctx) {
      root.append(h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "设置"))));
      const body = h("div", { class: "settings" });
      root.append(body);
      const c = { ...ctx, system: await api.system.info() };
      for (const sec of [...builtin, ...sections].sort((a, b) => (a.order ?? 50) - (b.order ?? 50))) {
        const box = h("div", { class: "set-group-body" });
        body.append(h("section", { class: "set-group", id: `settings-${sec.id}` }, h("h2", {}, sec.title), box));
        try { await sec.render(box, c); } catch (err) { window.Shell.reportError(err); box.append(h("p", { class: "error" }, err.message)); }
      }
    },
  });
})();
