// 複数ファイルをまとめて見るための組み立て。DOMに触れないのでテストできる。

import { findAppendedData, formatSize } from "./appended.js";
import { checkExtension } from "./extcheck.js";

/**
 * 1ファイルぶんの結果を、表の1行にまとめる。
 *
 * carving で取り出したファイルを確かめるのが主な用途なので、
 * 「完全かどうか」「名前と中身が合っているか」「後ろに何か付いているか」を
 * 1行で見比べられる形にする。
 */
export function summarizeFile({ name, size, hits, trailerChecked, sha256, appendedNames }) {
  const atHead = (hits || []).filter((h) => h.offset === 0);
  const formats = [...new Set(atHead.map((h) => h.name).filter(Boolean))];

  // 終端の状態は、先頭で当たったもののうち、いちばん強く言えるものを採る
  let trailer = "none";
  for (const hit of atHead) {
    if (hit.trailerState === "found") { trailer = "found"; break; }
    if (hit.trailerState === "missing") trailer = "missing";
    else if (hit.trailerState === "unchecked" && trailer === "none") trailer = "unchecked";
  }

  const appended = findAppendedData(hits || [], size, trailerChecked);
  const mismatch = checkExtension(name, hits || []);

  return {
    name,
    size,
    sizeText: formatSize(size),
    formats,
    formatText: formats.length ? formats[0] : null,
    hitCount: (hits || []).length,
    trailer,
    appendedBytes: appended ? appended.length : 0,
    // 後ろの領域に別のファイルの先頭が見えたかどうか。
    // 見えないなら、形式の終端構造の一部であることが多い
    appendedNames: appended ? (appendedNames || []) : [],
    mismatch: mismatch ? mismatch.extensions : null,
    executable: Boolean(mismatch && mismatch.executable),
    sha256: sha256 || ""
  };
}

/**
 * 表計算ソフトが数式として実行してしまう文字で始まるセルを無害にする。
 * =cmd|'/c calc'!A1 のような値が、開いただけで走ることがある。
 */
export function escapeCsvCell(value) {
  let text = value === null || typeof value === "undefined" ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\n\r,]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** 行の並びをCSVにする。先頭にBOMは付けない（呼ぶ側で決める） */
export function toCsv(rows, headers) {
  const lines = [headers.map((h) => escapeCsvCell(h.label)).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(h.value(row))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
