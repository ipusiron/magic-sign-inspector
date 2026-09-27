// 拡張子と中身がくい違っていないかを見る。DOMに触れないのでテストできる。

/** ファイル名から拡張子（小文字、ドットなし）を取る。無ければ null */
export function extensionOf(fileName) {
  const name = String(fileName || "");
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
}

/** 偽装されていたときに、特に気をつけたい形式か */
const EXECUTABLE = /(executable|実行ファイル|\bexe\b|\belf\b|mach-o|\bdll\b|script)/i;

/**
 * ファイル先頭のヒットから、中身が何なのかを見て、拡張子とくい違っていないかを返す。
 *
 * 誤って騒がないための決め事:
 *  - 見るのはオフセット0のヒットだけ。ファイルの途中にあるものは「中身」ではない
 *  - 同じバイト列を複数の形式が共有する（ZIP・DOCX・APKなど）ので、
 *    候補すべての拡張子を集め、その中にあれば「合っている」とみなす
 *  - ヒットが無い、拡張子が無い、というときは判定しない（黙る）
 *
 * @returns {null | {ext:string, names:string[], extensions:string[], executable:boolean}}
 */
export function checkExtension(fileName, hits, minConfidence = 0) {
  const ext = extensionOf(fileName);
  if (!ext) return null;
  if (!Array.isArray(hits) || !hits.length) return null;

  const atHead = hits.filter((h) => h.offset === 0 && (h.confidence ?? 80) >= minConfidence);
  if (!atHead.length) return null;

  const extensions = new Set();
  for (const hit of atHead) {
    for (const e of hit.extensions || []) {
      if (typeof e === "string") extensions.add(e.toLowerCase());
    }
  }
  // 拡張子を1つも持たない辞書では判定のしようがない
  if (!extensions.size) return null;
  if (extensions.has(ext)) return null;

  const names = [...new Set(atHead.map((h) => h.name).filter(Boolean))];
  return {
    ext,
    names,
    extensions: [...extensions].sort(),
    executable: names.some((n) => EXECUTABLE.test(n))
  };
}
