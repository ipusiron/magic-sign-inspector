import assert from "node:assert/strict";
import test from "node:test";

import { findAppendedData, formatSize, appendedFileName, identifyStart } from "../js/appended.js";

const jpegHit = (over = {}) => ({
  name: "JPEG (SOI)",
  offset: 0,
  trailerOffset: 998,
  trailerLength: 2,
  trailerState: "found",
  ...over
});

test("終端の後ろにデータがあれば、その位置と大きさを返す", () => {
  const info = findAppendedData([jpegHit()], 1275, true);
  assert.equal(info.start, 1000, "終端の開始ではなく、終端が終わった位置から");
  assert.equal(info.length, 275);
  assert.equal(info.base.name, "JPEG (SOI)");
});

test("終端でぴったり終わっていれば、何も言わない", () => {
  assert.equal(findAppendedData([jpegHit()], 1000, true), null);
});

test("終端が見つかっていないヒットだけなら、判定しない", () => {
  const hits = [jpegHit({ trailerState: "missing", trailerOffset: null })];
  assert.equal(findAppendedData(hits, 2000, true), null);
});

test("末尾を読まない走査では、推測しない", () => {
  // trailerChecked が false のときに答えを出すと、嘘をつくことになる
  assert.equal(findAppendedData([jpegHit()], 1275, false), null);
});

test("いちばん後ろで終わるものを、本体の終わりとみなす", () => {
  const hits = [
    jpegHit({ name: "A", trailerOffset: 500, trailerLength: 2 }),
    jpegHit({ name: "B", trailerOffset: 998, trailerLength: 2 })
  ];
  assert.equal(findAppendedData(hits, 1275, true).base.name, "B");
});

test("後ろの領域に入るヒットを添える", () => {
  const hits = [
    jpegHit(),
    { name: "ZIP", offset: 1000, trailerState: "none" },
    { name: "手前のもの", offset: 10, trailerState: "none" }
  ];
  const info = findAppendedData(hits, 1275, true);
  assert.deepEqual(info.inside.map((h) => h.name), ["ZIP"]);
});

test("trailerLength が無い古い形の結果でも、落ちずに扱う", () => {
  const hits = [jpegHit({ trailerLength: undefined })];
  const info = findAppendedData(hits, 1275, true);
  assert.equal(info.start, 998, "長さが分からないときは終端の開始から数える");
});

test("ヒットが無い、大きさが変、という場合は null", () => {
  assert.equal(findAppendedData([], 1000, true), null);
  assert.equal(findAppendedData(null, 1000, true), null);
  assert.equal(findAppendedData([jpegHit()], 0, true), null);
});

test("大きさは読める形にする", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(275), "275 B");
  assert.equal(formatSize(2048), "2.0 KB");
  assert.equal(formatSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatSize(-1), "-");
});

test("切り出したファイルの名前に、位置を残す", () => {
  assert.equal(appendedFileName("photo.jpg", 0x369c), "photo_appended_0x0000369C.bin");
  assert.equal(appendedFileName("no-extension", 16), "no-extension_appended_0x00000010.bin");
});

test("ファイル名に使えない文字は置き換える", () => {
  // 名前は利用者のファイルから来る。そのまま download に渡さない
  assert.equal(appendedFileName('bad:name*?.jpg', 0), "bad_name___appended_0x00000000.bin");
});

const entries = [
  { name: "ZIP", pattern: "50 4B 03 04", offset: { type: "absolute", value: 0 }, confidence: 90 },
  { name: "JPEG", pattern: "FF D8 FF", offset: { type: "absolute", value: 0 }, confidence: 90 },
  { name: "ZIP (long)", pattern: "50 4B 03 04 14 00", offset: { type: "absolute", value: 0 }, confidence: 80 },
  { name: "無効なもの", pattern: "50 4B", offset: { type: "absolute", value: 0 }, enabled: false },
  { name: "読めないもの", pattern: "ZZ", offset: { type: "absolute", value: 0 } },
  { name: "相対のもの", pattern: "50 4B", offset: { type: "relative", from: "x", delta: 0 } },
  { name: "少し先", pattern: "42 42", offset: { type: "absolute", value: 4 }, confidence: 70 }
];

test("後ろの部分の先頭が何かを言う。長く一致したものを先に置く", () => {
  const view = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const names = identifyStart(view, entries).map((f) => f.name);
  assert.equal(names[0], "ZIP (long)", "6バイト一致が先");
  assert.ok(names.includes("ZIP"));
  assert.ok(!names.includes("JPEG"));
});

test("無効なもの・読めないもの・相対のものは見ない", () => {
  const view = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
  const names = identifyStart(view, entries).map((f) => f.name);
  assert.ok(!names.includes("無効なもの"));
  assert.ok(!names.includes("読めないもの"));
  assert.ok(!names.includes("相対のもの"));
});

test("先頭から離れた位置の指定も、そのとおりに見る", () => {
  const view = Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x42, 0x42]);
  assert.deepEqual(identifyStart(view, entries).map((f) => f.name), ["少し先"]);
});

test("データが短ければ、はみ出す照合はしない", () => {
  const view = Uint8Array.from([0x50, 0x4b]);
  assert.deepEqual(identifyStart(view, entries), []);
});
