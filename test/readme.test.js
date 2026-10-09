import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseQuery, findAll } from "../js/search.js";
import { toForemostBytes } from "../js/dict.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const readmeEn = fs.readFileSync(path.join(root, "README.en.md"), "utf8");

test("README の「このツールならではの使い方」の値を計算部で再計算（日英）", () => {
  const data = Uint8Array.from([0, 0xff, 0xd8, 0xff, 0xe0, 0, 0xff, 0xd8, 0x11, 0, 0xff, 0xd8, 0xff]);
  const short = parseQuery("FF D8", "hex").bytes;
  const long = parseQuery("FF D8 FF E0", "hex").bytes;
  assert.deepEqual(findAll(data, short).hits, [1, 6, 10]);
  assert.deepEqual(findAll(data, long).hits, [1]);
  assert.deepEqual([...parseQuery("FF D8 FF", "hex").bytes], [255, 216, 255]);
  assert.equal(toForemostBytes("FF D8 FF ?? E0").value, "\\xff\\xd8\\xff?\\xe0");
  for (const md of [readme, readmeEn]) {
    assert.ok(md.includes("255 216 255"));
    assert.ok(md.includes("\\xff\\xd8\\xff?\\xe0"));
    assert.ok(md.includes("FF D8 FF E0"));
  }
});
