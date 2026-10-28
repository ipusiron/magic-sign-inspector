import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { read } from "./helper.js";

const app = read("js/app.js");
const NAMES = ["setThemeMode", "syncThemeControls", "onToggleTheme", "onFollowOSChange", "onOSThemeChange", "applyTheme"];

// app.js からテーマの関数だけを取り出し、仮の DOM・localStorage・OS 設定の上で動かす
function setup({ theme = "auto", prefersDark = false } = {}) {
  const source = NAMES.map((name) => {
    const m = app.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}`, "m"));
    assert.ok(m, `${name} が app.js に無い`);
    return m[0];
  }).join("\n");
  const classes = new Set();
  const os = { dark: prefersDark };
  const stored = {};
  const controls = { "#toggleTheme": { checked: false }, "#setFollowOS": { checked: true } };
  const ctx = {
    STATE: { theme },
    qs: (sel) => controls[sel],
    localStorage: { setItem: (k, v) => { stored[k] = v; } },
    window: { matchMedia: () => ({ matches: os.dark }) },
    document: { documentElement: { classList: {
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
    } } }
  };
  vm.runInNewContext(`${source}\nthis.api = { ${NAMES.join(", ")} };`, ctx);
  ctx.api.applyTheme(theme);
  ctx.api.syncThemeControls();
  return {
    ...ctx.api,
    os,
    stored,
    dark: () => classes.has("dark"),
    toggle: controls["#toggleTheme"],
    follow: controls["#setFollowOS"],
    state: ctx.STATE
  };
}

test("保存がない（auto）とき、「OSテーマを追従」にチェックが入り、OS の変化に追従する", () => {
  const t = setup({ theme: "auto", prefersDark: false });
  assert.equal(t.follow.checked, true);
  assert.equal(t.dark(), false);
  t.os.dark = true;
  t.onOSThemeChange();
  assert.equal(t.dark(), true);
  assert.equal(t.toggle.checked, true, "ヘッダーのダーク切り替えも見た目に合わせる");
});

test("ヘッダーで手で切り替えると、保存して OS には従わなくなる", () => {
  const t = setup({ theme: "auto", prefersDark: false });
  t.onToggleTheme({ target: { checked: true } });
  assert.equal(t.stored.msi_theme, "dark");
  assert.equal(t.follow.checked, false);
  t.os.dark = false;
  t.onOSThemeChange();
  assert.equal(t.dark(), true, "手で選んだダークのまま");
});

test("「OSテーマを追従」を入れると auto を保存し、OS の設定どおりになる", () => {
  const t = setup({ theme: "light", prefersDark: true });
  assert.equal(t.follow.checked, false);
  assert.equal(t.dark(), false);
  t.onFollowOSChange({ target: { checked: true } });
  assert.equal(t.stored.msi_theme, "auto");
  assert.equal(t.dark(), true);
  assert.equal(t.toggle.checked, true);
});

test("「OSテーマを追従」を外すと、いまの見た目のまま手動に固定する", () => {
  const t = setup({ theme: "auto", prefersDark: true });
  t.onFollowOSChange({ target: { checked: false } });
  assert.equal(t.stored.msi_theme, "dark");
  assert.equal(t.dark(), true);
  t.os.dark = false;
  t.onOSThemeChange();
  assert.equal(t.dark(), true);
});

test("想定外の保存値は js/theme-init.js と同じくライトで、OS には従わない", () => {
  const t = setup({ theme: "blue", prefersDark: true });
  assert.equal(t.dark(), false);
  assert.equal(t.follow.checked, false);
  t.onOSThemeChange();
  assert.equal(t.dark(), false);
});

test("「OSテーマを追従」が辞書の保存（saveLocal）ではなくテーマにつながっている", () => {
  assert.doesNotMatch(app, /#setFollowOS"\)\.addEventListener\("change", saveLocal\)/);
  assert.match(app, /#setFollowOS"\)\.addEventListener\("change", onFollowOSChange\)/);
  assert.match(app, /prefers-color-scheme: dark\)"\)\.addEventListener\?\.\("change", onOSThemeChange\)/);
});
