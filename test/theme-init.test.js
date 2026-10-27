import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { read } from "./helper.js";

const source = read("js/theme-init.js");

// theme-init.js を、保存値と OS 設定を差し替えた仮の window で動かし、<html> に dark が付くかを返す。
function run({ saved = null, prefersDark = false, storageThrows = false } = {}) {
  const classes = new Set();
  const keys = [];
  const window = {
    localStorage: {
      getItem: (key) => {
        keys.push(key);
        if (storageThrows) throw new Error("blocked");
        return saved;
      }
    },
    matchMedia: () => ({ matches: prefersDark }),
    document: { documentElement: { classList: { add: (c) => classes.add(c) } } }
  };
  vm.runInNewContext(source, { window });
  return { dark: classes.has("dark"), keys };
}

test("保存値がなければ OS の設定に従う", () => {
  assert.equal(run({ prefersDark: true }).dark, true);
  assert.equal(run({ prefersDark: false }).dark, false);
});

test("保存値は OS の設定より優先する", () => {
  assert.equal(run({ saved: "light", prefersDark: true }).dark, false);
  assert.equal(run({ saved: "dark", prefersDark: false }).dark, true);
});

test("auto は OS の設定に従い、想定外の値は app.js の applyTheme と同じくライトになる", () => {
  assert.equal(run({ saved: "auto", prefersDark: true }).dark, true);
  assert.equal(run({ saved: "auto", prefersDark: false }).dark, false);
  assert.equal(run({ saved: "blue", prefersDark: true }).dark, false);
});

test("localStorage が使えなくても落ちず、OS の設定に従う", () => {
  assert.equal(run({ storageThrows: true, prefersDark: true }).dark, true);
  assert.equal(run({ storageThrows: true, prefersDark: false }).dark, false);
});

test("保存キーは app.js と同じ msi_theme", () => {
  assert.deepEqual(run().keys, ["msi_theme"]);
  const app = read("js/app.js");
  assert.match(app, /localStorage\.getItem\("msi_theme"\)/);
  assert.match(app, /localStorage\.setItem\("msi_theme", mode\)/);
});

test("index.html の <head> で、stylesheet のあとに同期読み込みする", () => {
  const html = read("index.html");
  const head = html.slice(0, html.indexOf("</head>"));
  assert.ok(head.includes('<script src="js/theme-init.js"></script>'), "<head> に theme-init.js がない");
  assert.ok(head.indexOf("style.css") < head.indexOf("js/theme-init.js"));
});
