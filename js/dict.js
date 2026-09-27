// 辞書のエントリを検証する。DOMに触れないので、そのままテストできる。
// crypto.randomUUID は Node にもブラウザーにもある。

/**
 * インポートした辞書のエントリを検証する。
 * 以前は形を見ずにそのまま取り込み、localStorage へ残していたため、
 * パターンの書式が違うだけで走査全体が例外で止まり、
 * 余計なプロパティもそのまま永続化されていた。
 *
 * 通ったものだけを、こちらが知っている項目に絞って返す。
 */
const PATTERN_TOKEN_RE = /^(\?\?|[0-9A-Fa-f]{2}|\[[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}\])$/;

export function validateEntry(raw, index) {
  const where = `${index + 1}件目`;
  if (!raw || typeof raw !== "object") return { error: `${where}: 形が正しくありません` };

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { error: `${where}: 名前がありません` };

  const pattern = typeof raw.pattern === "string" ? raw.pattern.trim() : "";
  if (!pattern) return { error: `${where}（${name}）: パターンがありません` };
  const tokens = pattern.split(/\s+/);
  const badToken = tokens.find((t) => !PATTERN_TOKEN_RE.test(t));
  if (badToken) return { error: `${where}（${name}）: 読めないトークン ${badToken}` };

  const offsetType = raw.offset?.type === "relative" ? "relative" : "absolute";
  const offset = { type: offsetType };
  if (offsetType === "absolute") {
    const value = Number(raw.offset?.value ?? 0);
    if (!Number.isFinite(value) || value < 0) return { error: `${where}（${name}）: オフセットが正しくありません` };
    offset.value = value;
  } else {
    if (typeof raw.offset?.from === "string" && raw.offset.from.trim()) offset.from = raw.offset.from.trim();
    const delta = Number(raw.offset?.delta ?? 0);
    offset.delta = Number.isFinite(delta) ? delta : 0;
  }

  const confidence = Number(raw.confidence ?? 80);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    return { error: `${where}（${name}）: 信頼度は0〜100で指定してください` };
  }

  const entry = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : crypto.randomUUID(),
    name,
    pattern,
    offset,
    confidence,
    extensions: Array.isArray(raw.extensions) ? raw.extensions.filter((x) => typeof x === "string").slice(0, 16) : [],
    category: typeof raw.category === "string" ? raw.category.trim().slice(0, 32) : "",
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, 500) : "",
    enabled: raw.enabled !== false
  };

  if (typeof raw.trailer === "string" && raw.trailer.trim()) {
    const trailerTokens = raw.trailer.trim().split(/\s+/);
    if (trailerTokens.every((t) => PATTERN_TOKEN_RE.test(t))) {
      entry.trailer = raw.trailer.trim();
      entry.requires_trailer = raw.requires_trailer === true;
    }
  }
  for (const key of ["min_size", "max_size"]) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= 0) entry[key] = value;
  }

  return { entry };
}

/** 配列を検証して、通ったものと落ちた理由を返す */
export function validateEntries(list) {
  const accepted = [];
  const errors = [];
  list.forEach((raw, index) => {
    const result = validateEntry(raw, index);
    if (result.entry) accepted.push(result.entry);
    else errors.push(result.error);
  });
  return { accepted, errors };
}

