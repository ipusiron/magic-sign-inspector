import assert from "node:assert/strict";
import test from "node:test";

import { validateEntry, validateEntries } from "../js/dict.js";
import { read, loadI18n, render } from "./helper.js";

const I18n = loadI18n();

const base = { name: "Sample", pattern: "FF D8", offset: { type: "absolute", value: 0 } };

test("正しいエントリは通る", () => {
  const { entry, error } = validateEntry(base, 0);
  assert.equal(error, undefined);
  assert.equal(entry.name, "Sample");
  assert.equal(entry.pattern, "FF D8");
  assert.equal(entry.offset.value, 0);
  assert.equal(entry.confidence, 80);
  assert.ok(entry.id, "IDを割り当てていない");
});

test("名前かパターンがなければ落とす", () => {
  assert.equal(validateEntry({ pattern: "FF" }, 0).error.key, "dict.noName");
  assert.equal(validateEntry({ name: "x" }, 0).error.key, "dict.noPattern");
  assert.equal(validateEntry({ name: "x", pattern: "   " }, 0).error.key, "dict.noPattern");
});

test("読めないパターンは、名前を添えて落とす", () => {
  const { error } = validateEntry({ ...base, pattern: "FF ZZ" }, 3);
  assert.equal(error.key, "dict.badToken");
  assert.deepEqual(error.params, { n: 4, name: "Sample", token: "ZZ" });
  // 訳した文にも、どれが悪いのかが残っていること
  const text = render(error, I18n);
  assert.match(text, /4件目/);
  assert.match(text, /Sample/);
  assert.match(text, /ZZ/);
});

test("パターンのトークンは3種類だけを認める", () => {
  for (const pattern of ["FF", "??", "[00-1F]", "FF ?? [A0-AF]"]) {
    assert.equal(validateEntry({ ...base, pattern }, 0).error, undefined, pattern);
  }
  for (const pattern of ["FFF", "0xFF", "[00-]", "??? "]) {
    assert.ok(validateEntry({ ...base, pattern }, 0).error, `${pattern} を通している`);
  }
});

test("信頼度とオフセットの範囲を見る", () => {
  assert.equal(validateEntry({ ...base, confidence: 500 }, 0).error.key, "dict.badConfidence");
  assert.equal(validateEntry({ ...base, confidence: -1 }, 0).error.key, "dict.badConfidence");
  assert.equal(validateEntry({ ...base, offset: { type: "absolute", value: -5 } }, 0).error.key, "dict.badOffset");
});

test("知らない項目は持ち越さない", () => {
  const { entry } = validateEntry({ ...base, evil: "<img src=x>", __proto__ok: 1 }, 0);
  assert.equal(entry.evil, undefined, "知らない項目をそのまま残している");
  assert.deepEqual(
    Object.keys(entry).sort(),
    ["category", "confidence", "enabled", "extensions", "id", "name", "notes", "offset", "pattern"]
  );
});

test("終端と大きさは、形が正しいときだけ引き継ぐ", () => {
  const ok = validateEntry({ ...base, trailer: "FF D9", requires_trailer: true, min_size: 10, max_size: 100 }, 0).entry;
  assert.equal(ok.trailer, "FF D9");
  assert.equal(ok.requires_trailer, true);
  assert.equal(ok.min_size, 10);

  const bad = validateEntry({ ...base, trailer: "ZZ", min_size: "たくさん" }, 0).entry;
  assert.equal(bad.trailer, undefined);
  assert.equal(bad.min_size, undefined);
});

test("相対位置の from と delta を引き継ぐ", () => {
  const { entry } = validateEntry({ ...base, offset: { type: "relative", from: "anchor", delta: 4 } }, 0);
  assert.equal(entry.offset.type, "relative");
  assert.equal(entry.offset.from, "anchor");
  assert.equal(entry.offset.delta, 4);
});

test("落ちたものは件数と理由を返す", () => {
  const { accepted, errors } = validateEntries([
    base,
    { name: "壊れ", pattern: "ZZ" },
    { pattern: "FF" },
    { ...base, confidence: 500 }
  ]);
  assert.equal(accepted.length, 1);
  assert.equal(errors.length, 3);
});

test("一覧の行をHTML文字列で組み立てない", () => {
  const app = read("js/app.js");
  const section = app.slice(app.indexOf("function buildSigRow"), app.indexOf("function renderSigTable"));
  assert.doesNotMatch(section, /innerHTML/);
  assert.doesNotMatch(section, /`<tr/);
  // 以前は id を属性へ、拡張子とカテゴリを本文へ、そのまま差し込んでいた
  assert.match(section, /dataset: \{ id: String/);
  assert.match(section, /text: exts/);
  assert.match(section, /text: e\.category \|\| "-"/);
});

test("インラインのイベント属性を書かない", () => {
  for (const name of ["js/app.js", "js/hexview.js", "js/fileinfo.js", "js/shortcuts.js", "index.html"]) {
    assert.doesNotMatch(read(name), /\son[a-z]+\s*=\s*"/, `${name} にインラインハンドラーがある`);
  }
});
