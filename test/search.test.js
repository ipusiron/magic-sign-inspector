import assert from "node:assert/strict";
import test from "node:test";

import { parseQuery, findAll, stepIndex, describeByte } from "../js/search.js";
import { loadI18n, render } from "./helper.js";

const I18n = loadI18n();

test("16進は、空白・コロン・ハイフンのどれで区切ってもよい", () => {
  for (const text of ["FF D8", "FFD8", "ff:d8", "FF-D8", " ff d8 "]) {
    assert.deepEqual([...parseQuery(text, "hex").bytes], [0xff, 0xd8], text);
  }
});

test("16進として読めない入力は、どの文字が悪いかを言う", () => {
  const { error } = parseQuery("FF ZZ", "hex");
  assert.equal(error.key, "find.badHex");
  assert.equal(error.params.char, "Z");
  assert.match(render(error, I18n), /Z/);
});

test("16進が奇数桁なら断る", () => {
  assert.equal(parseQuery("FFD", "hex").error.key, "find.oddLength");
});

test("空の入力は、叱るためではなく黙るために区別する", () => {
  assert.equal(parseQuery("", "hex").error.key, "find.empty");
  assert.equal(parseQuery("   ", "text").error.key, "find.empty");
});

test("文字での検索は、そのままのバイトにする", () => {
  assert.deepEqual([...parseQuery("JFIF", "text").bytes], [0x4a, 0x46, 0x49, 0x46]);
});

test("1バイトに収まらない文字は、化かさずに断る", () => {
  // 黙って下位バイトだけ使うと、見つからない理由が分からなくなる
  const { error } = parseQuery("あ", "text");
  assert.equal(error.key, "find.nonAscii");
  assert.equal(error.params.char, "あ");
});

test("重なった出現も数える", () => {
  const view = Uint8Array.from([0xaa, 0xaa, 0xaa]);
  assert.deepEqual(findAll(view, Uint8Array.from([0xaa, 0xaa])).hits, [0, 1]);
});

test("見つかる位置をすべて返す", () => {
  const view = Uint8Array.from([0xff, 0xd8, 0x00, 0xff, 0xd8, 0xff, 0xd8]);
  assert.deepEqual(findAll(view, Uint8Array.from([0xff, 0xd8])).hits, [0, 3, 5]);
});

test("パターンがデータより長ければ、何も返さない", () => {
  const view = Uint8Array.from([0xff]);
  assert.deepEqual(findAll(view, Uint8Array.from([0xff, 0xd8])).hits, []);
});

test("多すぎるときは打ち切り、打ち切ったことを伝える", () => {
  const view = new Uint8Array(1000); // すべて 0x00
  const { hits, truncated } = findAll(view, Uint8Array.from([0x00]), 10);
  assert.equal(hits.length, 10);
  assert.equal(truncated, true);
});

test("次と前は端で回り込む", () => {
  assert.equal(stepIndex(3, 2, 1), 0);
  assert.equal(stepIndex(3, 0, -1), 2);
  assert.equal(stepIndex(3, -1, 1), 0, "まだどこにも居ないときは先頭へ");
  assert.equal(stepIndex(3, -1, -1), 2, "後ろへ動くなら末尾へ");
  assert.equal(stepIndex(0, -1, 1), -1, "1件も無ければ動かない");
});

test("バイトの説明は、表示できる文字のときだけ文字を添える", () => {
  assert.deepEqual(describeByte(0x4a), { hex: "4A", dec: 74, bin: "01001010", char: "J" });
  assert.equal(describeByte(0x00).char, null);
  assert.equal(describeByte(0x7f).char, null, "DELは表示できない");
  assert.equal(describeByte(0x20).char, " ", "空白は表示できる");
});
