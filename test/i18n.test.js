import assert from "node:assert/strict";
import test from "node:test";

import { read, loadI18n } from "./helper.js";

const I18n = loadI18n();
const html = read("index.html");

/** data-i18n="..." / data-i18n-title="..." などに書かれたキーを全部集める */
function keysInHtml() {
  const found = new Set();
  for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) found.add(m[1]);
  return [...found];
}

/** JS が t("...") / I18n.t("...") で呼んでいるキーを集める */
function keysInScripts() {
  const found = new Set();
  for (const name of ["js/app.js", "js/fileinfo.js", "js/hexview.js", "js/dict.js", "js/worker.js"]) {
    const source = read(name);
    for (const m of source.matchAll(/\bt\(\s*["']([a-zA-Z][\w.]*)["']/g)) found.add(m[1]);
    for (const m of source.matchAll(/key:\s*["']([a-zA-Z][\w.]*)["']/g)) found.add(m[1]);
  }
  return [...found];
}

test("日本語と英語で、キーの集合が同じ", () => {
  const ja = Object.keys(I18n.ja).sort();
  const en = Object.keys(I18n.en).sort();
  assert.deepEqual(ja.filter((k) => !(k in I18n.en)), [], "英語に無いキーがある");
  assert.deepEqual(en.filter((k) => !(k in I18n.ja)), [], "日本語に無いキーがある");
  assert.equal(ja.length, en.length);
});

test("差し込みの名前が、日本語と英語で一致する", () => {
  // {name} を訳し忘れると、英語だけ文字が欠けた文になる
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const mismatched = Object.keys(I18n.ja).filter((k) => holes(I18n.ja[k]) !== holes(I18n.en[k]));
  assert.deepEqual(mismatched, []);
});

test("index.html が指すキーは、すべて辞書にある", () => {
  const missing = keysInHtml().filter((k) => !(k in I18n.ja));
  assert.deepEqual(missing, []);
});

test("スクリプトが呼ぶキーは、すべて辞書にある", () => {
  const missing = keysInScripts().filter((k) => !(k in I18n.ja));
  assert.deepEqual(missing, []);
});

test("辞書に、日本語のまま残った英語訳がない", () => {
  const jp = /[぀-ヿ一-鿿]/;
  // 言語の切り替えボタンだけは、相手の言語を出すのが正しい
  const expected = new Set(["app.langButton"]);
  const untranslated = Object.keys(I18n.en).filter((k) => !expected.has(k) && jp.test(I18n.en[k]));
  assert.deepEqual(untranslated, []);
});

test("t() は差し込みを埋める。知らないキーは黙って通さない", () => {
  I18n.setLanguage;
  assert.match(I18n.t("toast.scanDone", { count: 3 }), /3/);
  assert.throws(() => I18n.t("no.such.key"), /Unknown message/);
});
