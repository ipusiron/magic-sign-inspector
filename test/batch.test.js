import assert from "node:assert/strict";
import test from "node:test";

import { summarizeFile, escapeCsvCell, toCsv } from "../js/batch.js";

const jpeg = (over = {}) => ({
  name: "JPEG (SOI)",
  extensions: ["jpg", "jpeg"],
  offset: 0,
  confidence: 90,
  trailerOffset: 998,
  trailerLength: 2,
  trailerState: "found",
  ...over
});

test("完全なファイルは、そう読める1行になる", () => {
  const row = summarizeFile({ name: "photo.jpg", size: 1000, hits: [jpeg()], trailerChecked: true, sha256: "ab" });
  assert.equal(row.formatText, "JPEG (SOI)");
  assert.equal(row.trailer, "found");
  assert.equal(row.appendedBytes, 0);
  assert.equal(row.mismatch, null);
  assert.equal(row.sizeText, "1000 B");
  assert.equal(row.sha256, "ab");
});

test("途中で切れたファイルは、終端が無いと分かる", () => {
  const hits = [jpeg({ trailerState: "missing", trailerOffset: null })];
  assert.equal(summarizeFile({ name: "photo.jpg", size: 1000, hits, trailerChecked: true }).trailer, "missing");
});

test("終端が見つかったものが1つでもあれば、found を採る", () => {
  // 同じ先頭に複数のシグネチャが当たる。いちばん強く言えるものを出す
  const hits = [jpeg({ name: "A", trailerState: "missing" }), jpeg({ name: "B", trailerState: "found" })];
  assert.equal(summarizeFile({ name: "photo.jpg", size: 1000, hits, trailerChecked: true }).trailer, "found");
});

test("末尾を読んでいない走査では、終端を未照合として出す", () => {
  const hits = [jpeg({ trailerState: "unchecked", trailerOffset: null })];
  assert.equal(summarizeFile({ name: "photo.jpg", size: 1000, hits, trailerChecked: false }).trailer, "unchecked");
});

test("後ろに付いたデータの大きさと、その中身を持つ", () => {
  const row = summarizeFile({
    name: "photo.jpg", size: 1275, hits: [jpeg()], trailerChecked: true, appendedNames: ["ZIP"]
  });
  assert.equal(row.appendedBytes, 275);
  assert.deepEqual(row.appendedNames, ["ZIP"]);
});

test("後ろに何も無ければ、中身の欄も空にする", () => {
  const row = summarizeFile({
    name: "photo.jpg", size: 1000, hits: [jpeg()], trailerChecked: true, appendedNames: ["変な値"]
  });
  assert.deepEqual(row.appendedNames, [], "余りが無いのに中身だけ残らない");
});

test("拡張子のくい違いを1行に含める", () => {
  const hits = [{ name: "EXE (MZ)", extensions: ["exe", "dll"], offset: 0, confidence: 90 }];
  const row = summarizeFile({ name: "photo.png", size: 100, hits, trailerChecked: true });
  assert.deepEqual(row.mismatch, ["dll", "exe"]);
  assert.equal(row.executable, true);
});

test("何も当たらなければ、形式は空のままにする", () => {
  const row = summarizeFile({ name: "unknown.bin", size: 10, hits: [], trailerChecked: true });
  assert.equal(row.formatText, null);
  assert.deepEqual(row.formats, []);
  assert.equal(row.trailer, "none");
});

test("表計算ソフトが数式として走らせる値を、無害にする", () => {
  // =cmd|'/c calc'!A1 のような値は、CSVを開いただけで実行されることがある。
  // ファイル名は利用者の手元から来るので、そのまま書き出さない
  assert.equal(escapeCsvCell("=1+1"), "'=1+1");
  assert.equal(escapeCsvCell("+1"), "'+1");
  assert.equal(escapeCsvCell("-1"), "'-1");
  assert.equal(escapeCsvCell("@SUM(A1)"), "'@SUM(A1)");
  // タブはCSVでは特別な文字ではないので、引用符では囲まない
  const TAB = String.fromCharCode(9);
  assert.equal(escapeCsvCell(TAB + "TAB"), "'" + TAB + "TAB");
});

test("引用符・カンマ・改行を含む値を、壊さずに書く", () => {
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvCell("a,b"), '"a,b"');
  assert.equal(escapeCsvCell("one\ntwo"), '"one\ntwo"');
  assert.equal(escapeCsvCell("ふつう"), "ふつう");
  assert.equal(escapeCsvCell(null), "");
  assert.equal(escapeCsvCell(0), "0");
});

test("CSVは、見出しと行をCRLFで区切る", () => {
  const headers = [
    { label: "名前", value: (r) => r.name },
    { label: "大きさ", value: (r) => r.size }
  ];
  const csv = toCsv([{ name: "a.jpg", size: 10 }, { name: "b,c.jpg", size: 20 }], headers);
  assert.equal(csv, '名前,大きさ\r\na.jpg,10\r\n"b,c.jpg",20\r\n');
});
