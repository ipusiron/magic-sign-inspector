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


/**
 * foremost.conf の1行に使う形へ直す。
 * foremost はバイトごとに \x を付けた書き方を読む。
 * 以前は "FF D8" を "\xffd8" と1つの \x でつなげて書き出しており、
 * 生成した conf はそのままでは使えなかった。
 * 任意の1バイト（??）は foremost の ? に置き換える。
 * 範囲指定（[00-1F]）は foremost に対応する書き方がないので、扱えないことを返す。
 */
export function toForemostBytes(pattern) {
  const tokens = (pattern || "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { error: "パターンが空です" };

  const parts = [];
  for (const token of tokens) {
    if (/^\?\?$/.test(token)) {
      parts.push("?");
    } else if (/^[0-9A-Fa-f]{2}$/.test(token)) {
      parts.push(`\\x${token.toLowerCase()}`);
    } else {
      return { error: `foremost では扱えない書き方です: ${token}` };
    }
  }
  return { value: parts.join("") };
}

/**
 * foremost.conf を読む。
 * 1行が「拡張子 大小文字の区別 サイズ ヘッダー [フッター]」で、# から後ろは注釈。
 * 自分で書き出した conf を読み戻せるようにする。
 */
export function parseForemostConf(text) {
  const accepted = [];
  const errors = [];

  const fromForemost = (token) => {
    const bytes = [];
    let i = 0;
    while (i < token.length) {
      if (token[i] === "?") { bytes.push("??"); i += 1; continue; }
      const m = token.slice(i).match(/^\\x([0-9A-Fa-f]{2})/);
      if (m) { bytes.push(m[1].toUpperCase()); i += 4; continue; }
      return null;
    }
    return bytes.length ? bytes.join(" ") : null;
  };

  (text || "").split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.split("#")[0].trim();
    if (!line) return;

    const cols = line.split(/\s+/);
    if (cols.length < 4) {
      errors.push(`${index + 1}行目: 列が足りません`);
      return;
    }

    const [ext, , sizeText, headerText, footerText] = cols;
    const pattern = fromForemost(headerText);
    if (!pattern) {
      errors.push(`${index + 1}行目（${ext}）: ヘッダーを読めません`);
      return;
    }

    const entry = {
      name: `${ext.toUpperCase()} (foremost)`,
      pattern,
      offset: { type: "absolute", value: 0 },
      extensions: [ext.replace(/^\./, "")],
      category: "imported",
      confidence: 80
    };

    const size = Number(sizeText);
    if (Number.isFinite(size) && size > 0) entry.max_size = size;

    if (footerText) {
      const trailer = fromForemost(footerText);
      if (trailer) {
        entry.trailer = trailer;
        entry.requires_trailer = true;
      }
    }

    accepted.push(entry);
  });

  return { accepted, errors };
}
