import assert from "node:assert/strict";
import test from "node:test";

import { toForemostBytes, parseForemostConf } from "../js/dict.js";
import { loadI18n, render } from "./helper.js";

const I18n = loadI18n();

const BS = String.fromCharCode(92);
const hex = (s) => s.split(" ").map((b) => `${BS}x${b.toLowerCase()}`).join("");

test("バイトごとに区切って書き出す", () => {
  // 以前は "FF D8 FF E0" を \\xffd8ffe0 のように1つの \\x でつなげており、foremost が読めなかった
  assert.equal(toForemostBytes("FF D8 FF E0").value, hex("FF D8 FF E0"));
  assert.equal(toForemostBytes("ff d8").value, hex("FF D8"));
});

test("任意の1バイトは foremost の ? にする", () => {
  assert.equal(toForemostBytes("FF ?? D8").value, `${BS}xff?${BS}xd8`);
});

test("範囲指定は扱えないと返す", () => {
  const { error, value } = toForemostBytes("[00-1F]");
  assert.equal(value, undefined);
  assert.equal(error.key, "foremost.unsupported");
  assert.match(render(error, I18n), /扱えない/);
});

test("空のパターンは扱えないと返す", () => {
  assert.ok(toForemostBytes("").error);
  assert.ok(toForemostBytes("   ").error);
});

test("foremost.conf を読み戻せる", () => {
  const line = `jpg\ty\t200000\t${hex("FF D8 FF E0")}\t${hex("FF D9")}`;
  const { accepted, errors } = parseForemostConf(`# 注釈${String.fromCharCode(10)}${line}`);

  assert.equal(errors.length, 0);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].pattern, "FF D8 FF E0");
  assert.equal(accepted[0].trailer, "FF D9");
  assert.equal(accepted[0].requires_trailer, true);
  assert.equal(accepted[0].max_size, 200000);
  assert.deepEqual(accepted[0].extensions, ["jpg"]);
});

test("書き出した形を、そのまま読み戻せる", () => {
  const pattern = "FF D8 ?? E0";
  const line = `jpg\ty\t1000\t${toForemostBytes(pattern).value}`;
  const { accepted } = parseForemostConf(line);
  assert.equal(accepted[0].pattern, pattern);
});

test("読めない行は、行番号を添えて落とす", () => {
  const { accepted, errors } = parseForemostConf(["jpg y", "png\ty\t100\tナニコレ"].join(String.fromCharCode(10)));
  assert.equal(accepted.length, 0);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].key, "dict.fewColumns");
  assert.equal(errors[1].key, "dict.badHeader");
  assert.match(render(errors[0], I18n), /1行目/);
  assert.match(render(errors[1], I18n), /2行目/);
});

test("注釈と空行は読み飛ばす", () => {
  const text = ["# comment", "", `jpg\ty\t100\t${hex("FF D8")}  # 行末の注釈`].join(String.fromCharCode(10));
  const { accepted, errors } = parseForemostConf(text);
  assert.equal(errors.length, 0);
  assert.equal(accepted.length, 1);
});

test("CSPを置き、style属性とインラインscriptを使わない", async () => {
  const { read } = await import("./helper.js");
  const html = read("index.html");

  const match = html.match(/Content-Security-Policy" content="([^"]+)"/);
  assert.ok(match, "meta CSPがない");
  const csp = match[1];
  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  // Web Worker を使うので worker-src が要る
  assert.match(csp, /worker-src 'self'/);

  // インラインの <script> は CSP で動かない。外部ファイルへ出してある
  assert.doesNotMatch(html, /<script>[\s\S]*?<\/script>/);

  for (const name of ["index.html", "js/app.js", "js/fileinfo.js", "js/hexview.js", "js/dict.js", "js/shortcuts.js"]) {
    assert.doesNotMatch(read(name), /\sstyle\s*=\s*"/, `${name} に style 属性がある`);
  }
});
