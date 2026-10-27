# Electron 应用模板

一个可以直接拿来开新项目的跨平台（macOS / Windows / Linux）Electron 模板，自带**应用内增量更新**：
发布小改动时用户只需下载几十 KB ~ 几 MB 的「应用层」，点一下「重启生效」就完成升级；新版本启动失败会自动退回安装包里的版本。

## 它给你什么

- **一个配置文件**：`app.config.json` 管应用名、appId、GitHub 仓库、tag 前缀、更新通道、下载镜像。启动器、更新器、打包、发布流程都从这里读，不用到处改名字。
- **增量更新**：只替换应用层（`app-update.asar`，纯 JS/HTML，不含原生模块），不重新下载 Electron 内核。一个增量包同时服务三个系统。
- **自动回滚**：新应用层抛异常、或在窗口加载完成后 10 秒内崩溃、或连续 2 次没启动成功 → 标记为坏版本，自动重启回安装包内置版本。
- **需要完整安装时自动识别**：Electron 大版本变了或启动器协议升级了，应用会提示并打开对应系统的安装包下载地址。
- **国内网络友好**：先直连 GitHub，慢或连不上自动换镜像（默认 `ghfast.top`），下载带 sha256 校验、卡顿检测、多源回退。
- **稳妥的窗口**：先隐藏创建、画好再显示（3 秒兜底）、单实例、macOS 默认关闭硬件加速（避开 Metal 黑屏问题）、页面加载和网络请求 25 秒超时。
- **安全默认值**：`contextIsolation` + `sandbox`，页面只能用 preload 暴露的 `window.app`；外链只放行 https 并交给系统浏览器。
- **示例界面**：一个页面，显示应用名、版本和来源（安装包内置 / 已更新），以及「应用更新」卡片（检查更新 / 下载更新带进度条 / 重启生效），错误都用中文说明。
- **CI 与发布**：GitHub Actions 三系统测试 + 真实启动冒烟测试；推 tag 自动出 dmg（Apple 芯片 + Intel）/ exe / AppImage 和增量包；也可以只发增量包。

## 5 分钟上手

1. **改配置** `app.config.json`：

   ```json
   {
     "appName": "my-electron-app",          // 英文名：数据目录、安装包文件名都用它
     "productName": "示例应用",              // 显示给用户的名字
     "appId": "com.example.myelectronapp",  // 反向域名，发布后不要再改
     "repo": "keovio/electron-app-template",// 发布用的 GitHub 仓库 owner/name
     "tagPrefix": "v",                      // 发布 tag 前缀：v1.2.3
     "channelTag": "latest-layer",          // 增量通道（一个固定的 Release）
     "mirrors": ["", "https://ghfast.top/"] // "" = 直连；按顺序尝试
   }
   ```
   （实际文件是纯 JSON，不能写注释。）`package.json` 里的 `version` 就是应用版本号。

2. **安装依赖**：`npm i`
   （网络装不了 Electron 时，可先 `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm i` 跑检查和测试，但 `npm start` 需要 Electron 本体。）

3. **运行**：`npm start`

在 `renderer/` 里写你的界面，在 `main.js` 里加主进程逻辑，通过 `preload.js` 暴露接口。应用图标：放一张 512×512 的 `build/icon.png` 即可（三个系统通用）。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm start` | 开发运行 |
| `npm run check` | 所有 JS 语法检查 + 配置校验 |
| `npm test` | 单元测试（`node --test`，不需要 Electron） |
| `npm run pack` | 打未打包的应用目录（`release/*-unpacked` 或 `release/mac-*`） |
| `npm run smoke` | 运行打包好的应用做冒烟测试（Linux 无桌面时 `xvfb-run -a npm run smoke`） |
| `npm run dist` | 打当前系统的安装包 |
| `npm run build:layer` | 构建增量包 `release/app-update.asar` + `app-update.json` |

## 发布

### 完整发布（安装包 + 增量包）

```bash
npm version 1.2.0 --no-git-tag-version   # 或手动改 package.json 的 version
echo "这次更新的一句话说明" > update-notes.txt
git commit -am "1.2.0" && git tag v1.2.0 && git push && git push --tags
```

`.github/workflows/release.yml` 会：在 macOS / Windows / Linux 上分别打 `dmg（arm64 + x64）`、`nsis exe`、`AppImage` → 在 Linux 上构建一份通用增量包 → 创建 Release `v1.2.0` 并上传全部文件 → 把 `app-update.json` 覆盖到增量通道 `latest-layer`（通道里已有更新版本时不覆盖，防止降级）→ 下载回来校验。

> 改了 `tagPrefix` 的话，记得同步改 `release.yml` 顶部的 `tags: ["v*"]`（触发规则读不了配置文件）。

### 只发增量包（小改动，不出安装包）

```bash
# 1. 改版本号，写说明
npm version 1.2.1 --no-git-tag-version
echo "修复了某某问题" > update-notes.txt
git commit -am "1.2.1"

# 2. 构建增量包；--installer-version 填最近一次完整发布的版本（需要完整安装时用户会被引导到那里）
npm run build:layer -- --version 1.2.1 --installer-version 1.2.0 --out layer

# 3. 推到分支 layer/v1.2.1（layer/ 在 .gitignore 里，要 -f）
git switch -c layer/v1.2.1
git add -f layer && git commit -m "layer 1.2.1" && git push origin layer/v1.2.1
git switch main && git push
```

4. 在 GitHub → Actions → **Publish Layer** → Run workflow，填 `1.2.1`。
   它会校验 sha256 / 大小 / 版本 / 下载地址，上传到 Release `v1.2.1`（没有就创建）和增量通道，再下载回来校验。
   由流程自动创建的 tag 不会再触发完整发布。

> **构建注意**：`build:layer` 会在系统临时目录里打包，写出后再读回来核对 sha256。在某些同步盘 / 网络文件系统（我们在一个工作区文件系统上遇到过）上，刚写的文件读回来会不一致，脚本会报错；这时把项目复制到 `/tmp` 再构建：
> `cp -r . /tmp/app && cd /tmp/app && npm run build:layer -- …`，再把 `/tmp/app/layer` 拷回来。

### 什么时候必须出完整安装包

- 升级了 Electron **大版本**（清单里的 `electron` 大版本与已安装的不同）
- 改了启动器协议：`boot/bootstrap.js`、`lib/update-core.js`、`lib/fs-utils.js`、`lib/config.js` 的行为变化时，把 `lib/update-core.js` 里的 `BOOT_PROTOCOL` 加 1
- 加了运行时依赖（`dependencies`）或原生模块：增量包不含 `node_modules`，`build:layer` 会拒绝构建

这些情况下旧版本会提示「需要下载完整安装包」，并打开对应系统（mac arm64 / mac x64 / win / linux）的下载地址。

## 更新和回滚是怎么工作的

```
安装包 app.asar ── boot/bootstrap.js（启动器，永不被替换）
                       │ 启动时检查 <数据目录>/updates/
                       ├─ 有更新、校验通过、没被标记坏 → 加载 app-<版本>.asar/main.js
                       └─ 否则 → 加载安装包内置的 main.js
```

- 数据目录：`app.getPath('appData')/<appName>`，即 macOS `~/Library/Application Support/<appName>`、Windows `%APPDATA%\<appName>`、Linux `~/.config/<appName>`；更新文件在其下的 `updates/`。
- 启动 6 秒后自动检查更新；能增量更新就在后台下载，下载完界面出现「重启生效」。
- 启动器选层时会校验：版本比内置新、清单字段完整、Electron 大版本一致、启动器协议兼容、文件大小和 **sha256** 一致。
- 每次加载新层前记一次「启动尝试」：
  - 窗口加载完成后再过 **10 秒**没崩溃（或正常退出）→ 记为成功，以后不再计数；
  - 加载时 / 10 秒内出现未捕获异常 → 立即标记坏版本，带原参数重启回内置版本；
  - 进程直接崩溃（来不及记录）→ 累计尝试次数，**连续 2 次**后第 3 次启动时标记坏版本、加载内置版本。
- 坏版本记录在 `updates/state.json`；用户在界面里重新下载同一版本时会清除记录，允许再试一次。
- 下载完成后只保留「正在用的版本 + 新版本」，旧文件自动清理。

## 网络慢时手动安装增量包

1. 从 Release 页下载 `app-update.asar` 和 `app-update.json`（可以用镜像，如 `https://ghfast.top/<原链接>`）。
2. 退出应用，放进数据目录的 `updates/`（没有就新建），改名为：
   - `app-update.asar` → `app-<版本>.asar`（例如 `app-1.2.1.asar`）
   - `app-update.json` → `app-<版本>.json`（例如 `app-1.2.1.json`）
3. 重新打开应用。sha256 或大小对不上会被自动忽略并退回内置版本。

## 启动参数

| 参数 | 作用 |
| --- | --- |
| `--no-updates` | 不加载已下载的应用层，也不自动检查更新（排查问题时用；环境变量 `APP_NO_UPDATES=1` 同效） |
| `--app-gpu` | macOS 上恢复显卡加速。默认关闭，因为部分 Mac 上 Chromium 的 ANGLE Metal 后端编译着色器失败（`Function main0 was not found`），窗口会一直黑屏 |
| `--smoke-test` | 冒烟测试：隐藏窗口加载页面，检查 preload 接口和页面内容后退出，输出 `SMOKE OK …`，退出码 0 = 通过 |

环境变量 `APP_UPDATES_DIR` 可以指定其他更新目录（测试用）。

## 目录结构

```
app.config.json          唯一配置
boot/bootstrap.js        启动器（package.json 的 main）
main.js / preload.js     主进程 / 预加载
renderer/                界面（index.html、app.js、style.css）
lib/config.js            读配置、算发布地址
lib/update-core.js       更新纯逻辑：选层、校验、回滚记录、错误翻译
lib/updater.js           检查 / 下载更新
lib/download.js          多源下载 + sha256 校验
lib/fs-utils.js          原子写 JSON、锁文件
build/build-layer.js     构建增量包
build/files.js           打包文件清单（安装包和增量包共用）
build/adhoc-sign.js      macOS ad-hoc 签名
electron-builder.config.js
scripts/                 check / smoke / 发布小工具
test/                    node --test 单元测试
.github/workflows/       ci.yml / release.yml / publish-layer.yml
```

## 签名说明

模板默认不做正式代码签名：macOS 只做 ad-hoc 签名（首次打开需在「系统设置 › 隐私与安全性」点「仍要打开」），Windows 安装包未签名（SmartScreen 可能提示）。有证书后按 electron-builder 文档配置即可。

## 许可证

MIT © 2026 keovio
