// HEXビューの検索。DOMに触れないので、そのままテストできる。

/**
 * 検索語を、照合できるバイトの並びにする。
 * mode="hex" は "FF D8" / "FFD8" / "ff-d8" のどれでも受ける。
 * mode="text" は入力した文字をそのままのバイトとして扱う（ASCIIの範囲のみ）。
 */
export function parseQuery(text, mode) {
  const raw = String(text ?? "");
  if (!raw.trim()) return { error: { key: "find.empty", params: {} } };

  if (mode === "text") {
    const bytes = [];
    for (const ch of raw) {
      const code = ch.codePointAt(0);
      // ASCIIの外は1バイトで表せない。黙って化かすより、どの文字かを伝える
      if (code > 0x7f) return { error: { key: "find.nonAscii", params: { char: ch } } };
      bytes.push(code);
    }
    return { bytes: Uint8Array.from(bytes) };
  }

  // 16進。区切りは空白・コロン・ハイフンのどれでもよい
  const cleaned = raw.replace(/[\s:\-]/g, "");
  if (!/^[0-9A-Fa-f]*$/.test(cleaned)) {
    const bad = cleaned.match(/[^0-9A-Fa-f]/)[0];
    return { error: { key: "find.badHex", params: { char: bad } } };
  }
  if (cleaned.length === 0) return { error: { key: "find.empty", params: {} } };
  if (cleaned.length % 2 !== 0) return { error: { key: "find.oddLength", params: {} } };

  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return { bytes };
}

/**
 * view の中から pattern の出現位置をすべて返す。重なりも数える。
 * limit を超えたら、そこで打ち切って truncated を立てる（数万件で画面を殺さない）。
 */
export function findAll(view, pattern, limit = 5000) {
  const hits = [];
  if (!view || !pattern || pattern.length === 0) return { hits, truncated: false };
  if (pattern.length > view.length) return { hits, truncated: false };

  const last = view.length - pattern.length;
  const first = pattern[0];
  for (let i = 0; i <= last; i += 1) {
    if (view[i] !== first) continue;
    let j = 1;
    while (j < pattern.length && view[i + j] === pattern[j]) j += 1;
    if (j === pattern.length) {
      hits.push(i);
      if (hits.length >= limit) return { hits, truncated: true };
    }
  }
  return { hits, truncated: false };
}

/** 今の位置から見て、次（step=1）または前（step=-1）のヒットの番号を返す。端では回り込む */
export function stepIndex(count, current, step) {
  if (count <= 0) return -1;
  if (current < 0) return step > 0 ? 0 : count - 1;
  return (current + step + count) % count;
}

/** 1バイトを、16進・10進・2進・表示できる文字で説明する */
export function describeByte(value) {
  const printable = value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : null;
  return {
    hex: value.toString(16).toUpperCase().padStart(2, "0"),
    dec: value,
    bin: value.toString(2).padStart(8, "0"),
    char: printable
  };
}
