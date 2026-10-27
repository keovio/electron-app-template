"use strict";
// 预加载脚本：在 contextIsolation + sandbox 下只暴露需要的几个接口给页面（window.app），页面拿不到 Node。
const { contextBridge, ipcRenderer } = require("electron");

// 订阅事件，返回取消订阅的函数
const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld("app", {
  info: () => ipcRenderer.invoke("app:info"),
  update: {
    info: () => ipcRenderer.invoke("update:info"),
    check: () => ipcRenderer.invoke("update:check"),
    download: () => ipcRenderer.invoke("update:download"),
    restart: () => ipcRenderer.invoke("update:restart"),
    openUrl: (url) => ipcRenderer.invoke("update:openUrl", url),
    onProgress: on("update:progress"),
    onStatus: on("update:status"),
  },
});
