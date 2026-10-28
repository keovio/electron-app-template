"use strict";
// 示例页面：新项目从这里开始改。复制这个文件就是一个新页面，记得在 index.html 里加 <script>。
(function () {
  const { h } = window.Shell;
  const api = window.app;

  window.Shell.registerPage({
    id: "home",
    title: "首页",
    icon: "home",   // 内置图标：home note folder search chart user star …；也可以写一个字，如 "笔"
    order: 10,
    render(root, ctx) {
      const step = (n, title, desc) => h("li", {}, h("b", {}, title), h("span", { class: "muted" }, " — " + desc));
      root.append(
        h("header", { class: "page-head" },
          h("div", {}, h("h1", {}, `欢迎使用 ${ctx.productName}`), h("p", { class: "sub" }, "这是一个示例页面，替换成你自己的内容就行"))),
        h("div", { class: "grid" },
          h("div", { class: "card" },
            h("h2", {}, "加一个页面"),
            h("ol", { class: "steps" },
              step(1, "新建 renderer/pages/xxx.js", "复制本文件，改 id、title、icon"),
              step(2, "在 index.html 里加一行 script", "放在「你的页面」那一段"),
              step(3, "在 render 里画界面", "用 Shell.h 或任何你喜欢的方式"))),
          h("div", { class: "card" },
            h("h2", {}, "试试外壳的功能"),
            h("div", { class: "actions" },
              h("button", { class: "btn primary", onclick: async () => {
                try { await window.Shell.tasks.run("demo", { steps: 20, interval: 200 }); window.Shell.toast("示例任务已在后台开始", "info"); }
                catch (e) { window.Shell.toast(e.message, "error"); }
              } }, "运行后台任务"),
              h("button", { class: "btn", onclick: () => { api.logs.write("info", "来自首页的一条日志", "home"); window.Shell.toast("已写入日志", "success"); } }, "写一条日志"),
              h("button", { class: "btn", onclick: () => window.Shell.saveSettings({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }) }, "切换深浅色"),
              h("button", { class: "btn ghost", onclick: () => window.Shell.navigate("settings") }, "打开设置")))));
    },
  });
})();
