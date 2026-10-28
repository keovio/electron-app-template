"use strict";
// 设置存储：<数据目录>/settings.json，带默认值和校验（纯 Node，可单测）。
// 新项目要加自己的设置项：在 main.js 里 createSettings({ file, schema: { ...BASE_SCHEMA, myKey: { type: "bool", default: false } } })。
const { readJson, writeJsonAtomic } = require("./fs-utils");

// type: bool | number（min/max/step）| enum（values）| string（maxLength）
const BASE_SCHEMA = {
  theme: { type: "enum", values: ["system", "light", "dark"], default: "system" },
  zoom: { type: "number", min: 0.8, max: 1.5, default: 1 },
  sidebarCollapsed: { type: "bool", default: false },
  sidebarWidth: { type: "number", min: 180, max: 360, step: 1, default: 220 },
  lastPage: { type: "string", maxLength: 64, default: "" },
  autoCheckUpdate: { type: "bool", default: true },
  openAtLogin: { type: "bool", default: false },
  logLevel: { type: "enum", values: ["debug", "info", "warn", "error"], default: "info" },
};

// 返回规范化后的值；不合法返回 undefined
function normalize(rule, v) {
  switch (rule.type) {
    case "bool": return typeof v === "boolean" ? v : undefined;
    case "number": {
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
      let x = Math.min(rule.max ?? Infinity, Math.max(rule.min ?? -Infinity, n));
      if (rule.step) x = Math.round(x / rule.step) * rule.step;
      return x;
    }
    case "enum": return rule.values.includes(v) ? v : undefined;
    case "string": return typeof v === "string" ? v.slice(0, rule.maxLength || 1000) : undefined;
    default: return undefined;
  }
}

function defaultsOf(schema) {
  const out = {};
  for (const [k, r] of Object.entries(schema)) out[k] = r.default;
  return out;
}

function createSettings({ file, schema = BASE_SCHEMA, fsImpl } = {}) {
  const listeners = new Set();
  const stored = readJson(file, {}, fsImpl);
  const values = defaultsOf(schema);
  // 读文件时也校验：手改坏的值退回默认
  if (stored && typeof stored === "object") {
    for (const [k, v] of Object.entries(stored)) {
      if (!schema[k]) continue;
      const n = normalize(schema[k], v);
      if (n !== undefined) values[k] = n;
    }
  }

  const save = () => { if (file) writeJsonAtomic(file, values, fsImpl); };
  const emit = (changed) => { for (const cb of listeners) { try { cb(changed, { ...values }); } catch { /* ignore */ } } };

  function get(key) { return key === undefined ? { ...values } : values[key]; }

  // 返回 { ok, settings, changed, errors }；部分键不合法时其余键照常写入
  function set(patch) {
    const errors = [];
    const changed = {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (!schema[k]) { errors.push(`未知设置项：${k}`); continue; }
      const n = normalize(schema[k], v);
      if (n === undefined) { errors.push(`设置项 ${k} 的值不合法`); continue; }
      if (values[k] !== n) { values[k] = n; changed[k] = n; }
    }
    if (Object.keys(changed).length) { save(); emit(changed); }
    return { ok: errors.length === 0, settings: { ...values }, changed, errors };
  }

  // 恢复默认：不传 keys = 全部
  function reset(keys) {
    const patch = {};
    for (const k of keys || Object.keys(schema)) if (schema[k]) patch[k] = schema[k].default;
    return set(patch);
  }

  function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

  return { get, set, reset, onChange, schema };
}

module.exports = { BASE_SCHEMA, createSettings, normalize, defaultsOf };
