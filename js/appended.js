// ファイルの終端より後ろに付いたデータを見つける。DOMに触れないのでテストできる。

/**
 * 「終端が見つかったヒット」のうち、いちばん後ろで終わるものを本体の終わりとみなし、
 * そこからファイル末尾までを「後ろに付いたデータ」として返す。
 *
 * JPEGの EOI の後ろにZIPを繋ぐのは古典的な隠し方で、
 * 画像として開くかぎり何も起きないため、見ただけでは気づけない。
 *
 * @param {Array} hits 走査の結果（offset・trailerOffset・trailerLength・trailerState を持つ）
 * @param {number} fileSize ファイル全体の大きさ
 * @param {boolean} trailerChecked 末尾まで読んだ走査かどうか
 * @returns {null | {start:number, length:number, base:object, inside:Array}}
 */
export function findAppendedData(hits, fileSize, trailerChecked) {
  // 末尾を読んでいない走査では、終端の位置が分からない。黙って推測しない
  if (!trailerChecked) return null;
  if (!Array.isArray(hits) || !hits.length) return null;
  if (!Number.isFinite(fileSize) || fileSize <= 0) return null;

  let base = null;
  let end = -1;
  for (const hit of hits) {
    if (hit.trailerState !== "found") continue;
    if (typeof hit.trailerOffset !== "number") continue;
    const length = typeof hit.trailerLength === "number" ? hit.trailerLength : 0;
    const finish = hit.trailerOffset + length;
    if (finish > end) {
      end = finish;
      base = hit;
    }
  }

  if (base === null || end < 0 || end >= fileSize) return null;

  // 後ろに付いた領域の中にヒットがあれば、何が隠れているのかが分かる
  const inside = hits
    .filter((h) => typeof h.offset === "number" && h.offset >= end)
    .sort((a, b) => a.offset - b.offset);

  return { start: end, length: fileSize - end, base, inside };
}

/** 「1,234 バイト」「1.2 MB」のように、桁の多い数を読める形にする */
export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 切り出したものに付けるファイル名。元の名前を残しつつ、位置が分かるようにする */
export function appendedFileName(originalName, start) {
  const safe = String(originalName || "file").replace(/[\\/:*?"<>|]/g, "_");
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  return `${stem}_appended_0x${start.toString(16).toUpperCase().padStart(8, "0")}.bin`;
}

/** "FF ?? [00-1F]" の並びを、照合できる部品にする。読めなければ null */
function compile(pattern) {
  const toks = String(pattern || "").trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const parts = [];
  for (const tok of toks) {
    if (/^\?\?$/.test(tok)) { parts.push({ kind: "any" }); continue; }
    const range = tok.match(/^\[([0-9A-Fa-f]{2})-([0-9A-Fa-f]{2})\]$/);
    if (range) { parts.push({ kind: "range", lo: parseInt(range[1], 16), hi: parseInt(range[2], 16) }); continue; }
    if (/^[0-9A-Fa-f]{2}$/.test(tok)) { parts.push({ kind: "byte", val: parseInt(tok, 16) }); continue; }
    return null;
  }
  return parts;
}

/**
 * 後ろに付いた部分の「先頭」が何なのかを調べる。
 *
 * 既定の辞書は184件のうち170件が offset:absolute 0 で、ファイル先頭でしか当たらない。
 * そのため、繋がれた側の書庫は走査では見つからない。
 * ここでは、その部分を1つのファイルとみなして先頭だけを照合する。
 * 走査そのものを緩めるわけではないので、誤検知は増えない。
 */
export function identifyStart(view, entries, limit = 5) {
  const found = [];
  if (!view || !view.length || !Array.isArray(entries)) return found;

  for (const entry of entries) {
    if (entry.enabled === false) continue;
    const offset = entry.offset || {};
    // 先頭から数えるものだけを見る。相対位置のものは基準が要るので扱わない
    if (offset.type === "relative") continue;
    const at = Number(offset.value ?? 0);
    if (!Number.isFinite(at) || at < 0) continue;

    const parts = compile(entry.pattern);
    if (!parts || at + parts.length > view.length) continue;

    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      const b = view[at + i];
      const p = parts[i];
      if (p.kind === "byte" && b !== p.val) { ok = false; break; }
      if (p.kind === "range" && (b < p.lo || b > p.hi)) { ok = false; break; }
    }
    if (ok) {
      found.push({ name: entry.name, confidence: entry.confidence ?? 80, length: parts.length });
      if (found.length >= limit) break;
    }
  }

  // 長く一致したものほど確からしい
  return found.sort((a, b) => b.length - a.length || b.confidence - a.confidence);
}
