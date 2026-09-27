import assert from "node:assert/strict";
import test from "node:test";

import { checkExtension, extensionOf } from "../js/extcheck.js";

const hit = (name, extensions, over = {}) => ({ name, extensions, offset: 0, confidence: 90, ...over });

test("拡張子を取り出す", () => {
  assert.equal(extensionOf("photo.jpg"), "jpg");
  assert.equal(extensionOf("PHOTO.JPG"), "jpg", "大文字でも同じに扱う");
  assert.equal(extensionOf("archive.tar.gz"), "gz", "最後のものを見る");
  assert.equal(extensionOf("no-extension"), null);
  assert.equal(extensionOf(".bashrc"), null, "先頭のドットは拡張子ではない");
  assert.equal(extensionOf("trailing."), null);
  assert.equal(extensionOf(""), null);
  assert.equal(extensionOf("weird.name with space"), null, "拡張子らしくないものは見ない");
});

test("拡張子と中身が合っていれば、何も言わない", () => {
  const hits = [hit("JPEG (SOI)", ["jpg", "jpeg"])];
  assert.equal(checkExtension("photo.jpg", hits), null);
  assert.equal(checkExtension("photo.JPEG", hits), null);
});

test("くい違っていれば、名前と、本来の拡張子を返す", () => {
  const hits = [hit("ZIP", ["zip"]), hit("Android APK", ["apk"])];
  const info = checkExtension("photo.jpg", hits);
  assert.equal(info.ext, "jpg");
  assert.deepEqual(info.names, ["ZIP", "Android APK"]);
  assert.deepEqual(info.extensions, ["apk", "zip"]);
  assert.equal(info.executable, false);
});

test("同じバイト列を共有する形式は、まとめて「合っている」とみなす", () => {
  // .docx は ZIP と同じ並びで始まる。ZIP がヒットしても偽装ではない
  const hits = [hit("ZIP", ["zip"]), hit("DOCX", ["docx"])];
  assert.equal(checkExtension("report.docx", hits), null);
});

test("実行ファイルが別の拡張子で置かれていたら、そう言う", () => {
  assert.equal(checkExtension("image.png", [hit("EXE (MZ)", ["exe", "dll"])]).executable, true);
  assert.equal(checkExtension("image.png", [hit("ELF 実行ファイル", ["elf"])]).executable, true);
  assert.equal(checkExtension("image.png", [hit("Mach-O", ["macho"])]).executable, true);
  assert.equal(checkExtension("image.png", [hit("ZIP", ["zip"])]).executable, false);
});

test("ファイルの途中にあるヒットは、中身の判定に使わない", () => {
  // 画像の後ろに繋がれた書庫を「中身」と言ってはいけない
  const hits = [hit("JPEG (SOI)", ["jpg"]), hit("ZIP", ["zip"], { offset: 13980 })];
  assert.equal(checkExtension("photo.jpg", hits), null);
});

test("判定できないときは黙る", () => {
  assert.equal(checkExtension("noextension", [hit("JPEG", ["jpg"])]), null, "拡張子が無い");
  assert.equal(checkExtension("photo.jpg", []), null, "ヒットが無い");
  assert.equal(checkExtension("photo.jpg", null), null);
  assert.equal(checkExtension("photo.jpg", [hit("名前だけ", [])]), null, "辞書に拡張子が無い");
});

test("信頼度の下限を指定できる", () => {
  const hits = [hit("怪しい2バイト", ["bin"], { confidence: 40 })];
  assert.ok(checkExtension("photo.jpg", hits, 0), "既定では見る");
  assert.equal(checkExtension("photo.jpg", hits, 70), null, "下限を上げれば見ない");
});
