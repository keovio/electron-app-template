"use strict";
// 内置页面：日志。实时显示主进程和页面写的日志，可按级别 / 关键字筛选、暂停自动滚动、复制、打开日志文件夹。
// 页面里写日志：window.app.logs.write("info", "消息", "模块名")
(function () {
  const { h } = window.Shell;
  const api = window.app;
  const MAX_ROWS = 2000;
  const LEVEL_TEXT = { debug: "调试", info: "信息", warn: "警告", error: "错误" };
  const RANK = { debug: 0, info: 1, warn: 2, error: 3 };

  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const ts = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };
  const line = (e) => `${ts(e.time)} [${e.level.toUpperCase()}]${e.scope ? ` [${e.scope}]` : ""} ${e.message}`;

  window.Shell.registerPage({
    id: "logs", title: "日志", icon: "logs", section: "system", order: 20,
    render(root) {
      let entries = [];
      let level = "";
      let query = "";
      let follow = true;
      let unseenErrors = 0;

      const levelSel = h("select", { class: "input", title: "最低级别", onchange: () => { level = levelSel.value; redraw(); } },
        h("option", { value: "" }, "全部级别"),
        ...["debug", "info", "warn", "error"].map((l) => h("option", { value: l }, `${LEVEL_TEXT[l]}及以上`)));
      const search = h("input", { class: "input grow", type: "search", placeholder: "搜索日志…", oninput: window.Shell.debounce(() => { query = search.value.trim().toLowerCase(); redraw(); }, 150) });
      const followBox = h("input", { type: "checkbox", checked: true, onchange: () => { follow = followBox.checked; if (follow) scrollEnd(); } });
      const list = h("div", { class: "log-list", tabindex: "0" });
      const count = h("span", { class: "muted small" });

      const match = (e) => (!level || RANK[e.level] >= RANK[level]) && (!query || e.message.toLowerCase().includes(query) || e.scope.toLowerCase().includes(query));
      const row = (e) => h("div", { class: `log-row ${e.level}` },
        h("span", { class: "log-time" }, ts(e.time)),
        h("span", { class: "log-level" }, LEVEL_TEXT[e.level] || e.level),
        e.scope ? h("span", { class: "log-scope" }, e.scope) : null,
        h("span", { class: "log-msg" }, e.message));
      const scrollEnd = () => { list.scrollTop = list.scrollHeight; };
      const shown = () => entries.filter(match);
      function redraw() {
        const s = shown();
        list.replaceChildren(...s.slice(-MAX_ROWS).map(row));
        count.textContent = `${s.length} 条`;
        if (follow) scrollEnd();
      }
      function append(batch) {
        entries.push(...batch);
        if (entries.length > MAX_ROWS) entries = entries.slice(-MAX_ROWS);
        const add = batch.filter(match);
        if (!add.length) return;
        // 用户往上翻时暂停跟随
        const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
        list.append(...add.map(row));
        while (list.childElementCount > MAX_ROWS) list.firstElementChild.remove();
        count.textContent = `${shown().length} 条`;
        if (follow && atEnd) scrollEnd();
      }

      root.classList.add("page-fill");
      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, "日志"), h("p", { class: "sub" }, "排查问题时把这里的内容复制给开发者")),
          h("div", { class: "actions" },
            h("button", { class: "btn", onclick: async () => {
              await navigator.clipboard.writeText(shown().map(line).join("\n"));
              window.Shell.toast("已复制到剪贴板", "success");
            } }, "复制"),
            h("button", { class: "btn", onclick: () => api.logs.openDir() }, "打开日志文件夹"),
            h("button", { class: "btn ghost", onclick: async () => { await api.logs.clear(); entries = []; redraw(); } }, "清空"))),
        h("div", { class: "toolbar" }, levelSel, search, h("label", { class: "check" }, followBox, "自动滚动"), count),
        list);

      api.logs.list({ limit: MAX_ROWS }).then((l) => { entries = l; redraw(); });
      api.logs.onEntries((batch) => {
        append(batch);
        if (window.Shell.current !== "logs") {
          unseenErrors += batch.filter((e) => e.level === "error").length;
          window.Shell.setBadge("logs", unseenErrors ? "!" : "");
        }
      });
      this._clearBadge = () => { unseenErrors = 0; window.Shell.setBadge("logs", ""); };
    },
    onShow() { if (this._clearBadge) this._clearBadge(); },
  });
})();
