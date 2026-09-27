import assert from "node:assert/strict";
import test from "node:test";

import { entropyOf, blockEntropies, entropyBand, findJumps } from "../js/entropy.js";

/** 同じ値だけが並ぶデータ */
const flat = (n, value = 0) => new Uint8Array(n).fill(value);

/** 0..255 を繰り返す。偏りがまったく無いので 8.0 になる */
const uniform = (n) => Uint8Array.from({ length: n }, (_, i) => i % 256);

test("同じ値だけなら 0 になる", () => {
  assert.equal(entropyOf(flat(1000)), 0);
  assert.equal(entropyOf(flat(1000, 0xff)), 0);
});

test("256通りが同じ数だけ並べば 8 になる", () => {
  assert.equal(entropyOf(uniform(2560)), 8);
});

test("2種類が半々なら 1 になる", () => {
  const view = Uint8Array.from({ length: 1000 }, (_, i) => (i % 2 ? 1 : 0));
  assert.equal(entropyOf(view), 1);
});

test("範囲を指定して測れる", () => {
  const view = new Uint8Array(1000);
  view.set(uniform(500), 500); // 後半だけばらつく
  assert.equal(entropyOf(view, 0, 500), 0, "前半は同じ値だけ");
  assert.ok(entropyOf(view, 500, 1000) > 7, "後半はばらついている");
});

test("空や範囲外は 0 にする", () => {
  assert.equal(entropyOf(new Uint8Array(0)), 0);
  assert.equal(entropyOf(flat(10), 5, 5), 0);
  assert.equal(entropyOf(flat(10), 20, 30), 0);
});

test("ファイルを分けて測る", () => {
  const view = new Uint8Array(4096);
  view.set(uniform(2048), 2048);
  const blocks = blockEntropies(view, 4, 512);
  assert.equal(blocks.length, 4);
  assert.equal(blocks[0].start, 0);
  assert.equal(blocks[3].end, 4096, "最後の区間は末尾まで");
  assert.equal(blocks[0].value, 0, "前半は同じ値だけ");
  assert.ok(blocks[3].value > 7, "後半はばらついている");
});

test("区間が小さくなりすぎないようにする", () => {
  // 256通りに対して標本が少なすぎると、値は偏りではなく標本数で下がる。
  // 31KBを128に割ると1区間242バイトになり、ランダムでも 7.1 程度にしかならない
  const view = uniform(31000);
  const blocks = blockEntropies(view, 128, 512);
  assert.ok(blocks.length <= 60, `区間が多すぎる: ${blocks.length}`);
  assert.ok((view.length / blocks.length) >= 512, "1区間は512バイト以上");
});

test("小さいファイルでも、1区間は返す", () => {
  const blocks = blockEntropies(flat(100), 128, 512);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].end, 100);
});

test("中身が無ければ空を返す", () => {
  assert.deepEqual(blockEntropies(new Uint8Array(0)), []);
  assert.deepEqual(blockEntropies(null), []);
});

test("値を、意味の分かる区分に置き換える", () => {
  assert.equal(entropyBand(0), "flat");
  assert.equal(entropyBand(0.5), "flat");
  assert.equal(entropyBand(3), "low");
  assert.equal(entropyBand(4.5), "text");
  assert.equal(entropyBand(7), "mixed");
  assert.equal(entropyBand(7.9), "high");
  assert.equal(entropyBand(8), "high");
});

test("値が飛んでいる境目を見つける", () => {
  const blocks = [
    { start: 0, end: 100, value: 4.4 },
    { start: 100, end: 200, value: 4.5 },
    { start: 200, end: 300, value: 0.5 },
    { start: 300, end: 400, value: 7.6 }
  ];
  const jumps = findJumps(blocks, 2);
  assert.equal(jumps.length, 2);
  assert.equal(jumps[0].at, 200);
  assert.equal(jumps[0].rising, false, "下がる境目");
  assert.equal(jumps[1].at, 300);
  assert.equal(jumps[1].rising, true, "上がる境目");
});

test("なだらかな変化は、境目として数えない", () => {
  const blocks = [0, 1, 2, 3].map((i) => ({ start: i * 100, end: (i + 1) * 100, value: 4 + i * 0.3 }));
  assert.deepEqual(findJumps(blocks, 2), []);
});
