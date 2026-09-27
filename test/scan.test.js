import assert from "node:assert/strict";
import test from "node:test";

import { loadWorker, bytes, concat, zeros } from "./helper.js";

const JPEG_HEAD = "FF D8 FF E0";
const JPEG_EOI = "FF D9";

const sigJpegComplete = {
  id: "sig-jpeg-complete",
  name: "JPEG (Complete)",
  pattern: "FF D8",
  offset: { type: "absolute", value: 0 },
  trailer: JPEG_EOI,
  requires_trailer: true,
  confidence: 95
};

const sigJpegSoi = {
  id: "sig-jpeg-soi",
  name: "JPEG (SOI)",
  pattern: "FF D8",
  offset: { type: "absolute", value: 0 },
  confidence: 90
};

test("終端の並びがあるときだけ「完全」とみなす", async () => {
  const worker = loadWorker();

  const complete = concat(bytes(JPEG_HEAD), zeros(32), bytes(JPEG_EOI));
  const done = await worker.scan({
    fileSize: complete.byteLength,
    segments: [{ buffer: complete, base: 0 }],
    signatures: [sigJpegSoi, sigJpegComplete]
  });
  assert.equal(done.type, "done");
  assert.deepEqual(done.hits.map((h) => h.name).sort(), ["JPEG (Complete)", "JPEG (SOI)"]);
});

test("終端の並びがなければ「完全」とみなさない", async () => {
  const worker = loadWorker();

  // FF D9 で終わっていない、途中で切れたJPEG
  const truncated = concat(bytes(JPEG_HEAD), zeros(32));
  const done = await worker.scan({
    fileSize: truncated.byteLength,
    segments: [{ buffer: truncated, base: 0 }],
    signatures: [sigJpegSoi, sigJpegComplete]
  });
  // 「完全」は落ちるが、開始マーカーは残る。
  // 途中で切れたファイルを何も検出できなくなっては、フォレンジックで役に立たない
  assert.deepEqual(done.hits.map((h) => h.name), ["JPEG (SOI)"]);
});

test("終端の有無を、ヒットごとに報告する", async () => {
  const worker = loadWorker();
  // 開始マーカー側にも trailer が書かれている（既定の辞書がそうなっている）
  const soiWithTrailer = { ...sigJpegSoi, trailer: JPEG_EOI };

  const complete = concat(bytes(JPEG_HEAD), zeros(32), bytes(JPEG_EOI));
  const found = await worker.scan({
    fileSize: complete.byteLength,
    segments: [{ buffer: complete, base: 0 }],
    signatures: [soiWithTrailer]
  });
  assert.equal(found.hits[0].trailerState, "found");
  assert.equal(found.hits[0].trailerOffset, complete.byteLength - 2);

  const truncated = concat(bytes(JPEG_HEAD), zeros(32));
  const missing = await worker.scan({
    fileSize: truncated.byteLength,
    segments: [{ buffer: truncated, base: 0 }],
    signatures: [soiWithTrailer]
  });
  assert.equal(missing.hits.length, 1, "終端がないだけで落としている");
  assert.equal(missing.hits[0].trailerState, "missing");
});

test("末尾を見られない走査では、終端を要求するシグネチャを通さない", async () => {
  const worker = loadWorker();

  const whole = concat(bytes(JPEG_HEAD), zeros(1000), bytes(JPEG_EOI));
  // 先頭だけを渡し、fileSize は全体の大きさにする
  const done = await worker.scan({
    fileSize: whole.byteLength,
    segments: [{ buffer: whole.slice(0, 64), base: 0 }],
    signatures: [sigJpegSoi, sigJpegComplete]
  });
  assert.deepEqual(done.hits.map((h) => h.name), ["JPEG (SOI)"]);
  assert.equal(done.trailerChecked, false);
  assert.equal(done.skipped.trailerUnverifiable, 1, "落とした件数を報告していない");
});

test("大きさの条件でふるいにかける", async () => {
  const worker = loadWorker();
  const sig = { id: "big", name: "Big only", pattern: "FF D8", offset: { type: "absolute", value: 0 }, min_size: 1000 };
  const small = concat(bytes(JPEG_HEAD), zeros(10));

  const done = await worker.scan({
    fileSize: small.byteLength,
    segments: [{ buffer: small, base: 0 }],
    signatures: [sig]
  });
  assert.equal(done.hits.length, 0);
  assert.equal(done.skipped.outOfSize, 1);
});

test("末尾側のヒットは、ファイルの実座標で報告する", async () => {
  const worker = loadWorker();
  const sigPng = {
    id: "png", name: "PNG", pattern: "89 50 4E 47",
    offset: { type: "relative" }, confidence: 95
  };

  const fileSize = 4096;
  const tailStart = 4000;
  const tail = concat(zeros(50), bytes("89 50 4E 47"), zeros(42));

  const done = await worker.scan({
    fileSize,
    segments: [
      { buffer: zeros(64), base: 0 },
      { buffer: tail, base: tailStart }
    ],
    signatures: [sigPng]
  });

  assert.equal(done.hits.length, 1);
  // 連結して走査していた頃は 64 + 50 = 114 になっていた
  assert.equal(done.hits[0].offset, tailStart + 50);
});

test("相対位置は、基準のヒットからの差で見る", async () => {
  const worker = loadWorker();
  const anchor = { id: "anchor", name: "Anchor", pattern: "AA BB", offset: { type: "absolute", value: 0 } };
  const follower = {
    id: "follower", name: "Follower", pattern: "CC DD",
    offset: { type: "relative", from: "anchor", delta: 4 }
  };

  const buffer = bytes("AA BB 00 00 CC DD 00 00 CC DD");
  const done = await worker.scan({
    fileSize: buffer.byteLength,
    segments: [{ buffer, base: 0 }],
    signatures: [anchor, follower]
  });

  const followers = done.hits.filter((h) => h.name === "Follower");
  assert.equal(followers.length, 1, "総当たりになっている");
  assert.equal(followers[0].offset, 4);
});

test("パターンを読めないシグネチャがあっても、走査全体を止めない", async () => {
  const worker = loadWorker();
  const broken = { id: "broken", name: "Broken", pattern: "ZZ", offset: { type: "absolute", value: 0 } };

  const buffer = bytes(JPEG_HEAD);
  const done = await worker.scan({
    fileSize: buffer.byteLength,
    segments: [{ buffer, base: 0 }],
    signatures: [broken, sigJpegSoi]
  });

  assert.equal(done.type, "done");
  assert.deepEqual(done.hits.map((h) => h.name), ["JPEG (SOI)"]);
  assert.equal(done.skipped.invalidPattern.length, 1);
  assert.equal(done.skipped.invalidPattern[0].name, "Broken");
});
