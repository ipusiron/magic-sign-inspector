// Web Worker: バッファをシグネチャと照合する。
//
// 受け取るメッセージ
// { cmd: "scan", fileSize, segments: [{ buffer, base }], signatures }
//   segments は走査する区間。base はファイル先頭から数えた実座標。
//   先頭と末尾だけを走査する場合も、区間を2つ渡せば実座標のまま報告できる。
//   以前は先頭と末尾を1本に連結して渡していたため、末尾側のヒット位置が
//   ファイルの実座標とずれていた。
//
// シグネチャの形
// { id, name, pattern, offset: {type:"absolute"|"relative", value?, from?, delta?},
//   trailer?, min_size?, max_size?, confidence }
//   trailer が指定されたものは、ファイル末尾を照合できるときだけヒットさせる。
//   照合できない範囲の走査では、黙って通さずに件数を返す。

const DEBUG = false;
const log = (...args) => { if (DEBUG) console.log(...args); };

self.addEventListener("message", async (e) => {
  const { cmd } = e.data || {};
  if (cmd !== "scan") return;

  try {
    const { signatures, fileSize } = e.data;
    const segments = (e.data.segments || []).map((s) => ({
      view: new Uint8Array(s.buffer),
      base: s.base || 0
    }));

    const active = signatures.filter((s) => s.enabled !== false && s.pattern && s.offset);
    const compiled = [];
    const invalid = [];
    for (const sig of active) {
      try {
        compiled.push(compileSig(sig));
      } catch (err) {
        // 1件の書式違いで走査全体を止めない
        invalid.push({ name: sig.name || sig.id || "(no name)", reason: String(err && err.message || err) });
      }
    }

    // 末尾を含む区間があるか。なければトレーラーの照合はできない
    const endSegment = segments.find((s) => s.base + s.view.length >= fileSize);

    const context = { fileSize, segments, endSegment, skippedTrailer: 0, skippedSize: 0 };
    const hits = [];

    const absolute = compiled.filter((c) => c.offsetType === "absolute");
    const relative = compiled.filter((c) => c.offsetType === "relative");
    log(`scan: ${segments.length} segments, ${absolute.length} absolute, ${relative.length} relative`);

    let completed = 0;
    const totalTasks = Math.max(1, absolute.length + (relative.length > 0 ? 1 : 0));

    for (const c of absolute) {
      const segment = segments.find((s) => c.offsetValue >= s.base && c.offsetValue < s.base + s.view.length);
      if (segment) {
        matchAt(segment.view, c, c.offsetValue - segment.base, segment.base, hits, context);
      }
      completed += 1;
      self.postMessage({ type: "progress", progress: Math.round(completed / totalTasks * 80) });
    }

    if (relative.length > 0) {
      await scanRelative(relative, hits, context);
    }

    finalizeScan(hits, context, invalid);
  } catch (err) {
    self.postMessage({ type: "error", error: String(err && err.message || err) });
  }
});

/** "FF ?? [00-1F]" のような並びを、照合できる形にする */
function compileParts(pattern) {
  const toks = (pattern || "").trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) throw new Error("パターンが空です");
  return toks.map((tok) => {
    if (/^\?\?$/.test(tok)) return { kind: "any" };
    const mRange = tok.match(/^\[([0-9A-Fa-f]{2})-([0-9A-Fa-f]{2})\]$/);
    if (mRange) return { kind: "range", lo: parseInt(mRange[1], 16), hi: parseInt(mRange[2], 16) };
    if (/^[0-9A-Fa-f]{2}$/.test(tok)) return { kind: "byte", val: parseInt(tok, 16) };
    throw new Error(`扱えないトークンです: ${tok}`);
  });
}

function compileSig(sig) {
  const parts = compileParts(sig.pattern);

  const offsetType = sig.offset?.type || "absolute";
  let offsetValue = 0;
  if (sig.offset && typeof sig.offset.value !== "undefined") {
    const parsed = Number(sig.offset.value);
    offsetValue = Number.isNaN(parsed) ? 0 : parsed;
  }

  const toNumber = (value) => {
    if (value === null || typeof value === "undefined" || value === "") return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  return {
    id: sig.id,
    name: sig.name,
    confidence: sig.confidence ?? 80,
    parts,
    length: parts.length,
    offsetType,
    offsetValue,
    // 相対位置。from は基準にするシグネチャの名前かID
    from: sig.offset?.from || null,
    delta: toNumber(sig.offset?.delta) ?? 0,
    // 末尾の並び。照合して結果を報告する。
    // ヒットを拒むのは requires_trailer を立てたものだけ。
    // 「JPEG (SOI)」のような開始マーカーは、終端がなくてもヒットさせる。
    // そうしないと、途中で切れたファイルを何も検出できなくなり、
    // フォレンジックの用途では役に立たない。
    trailerParts: sig.trailer ? compileParts(sig.trailer) : null,
    requiresTrailer: sig.requires_trailer === true,
    minSize: toNumber(sig.min_size),
    maxSize: toNumber(sig.max_size)
  };
}

/** 区間の中の位置 pos で照合する。base を足して実座標で報告する。 */
function matchAt(view, c, pos, base, hits, context) {
  if (typeof pos !== "number" || Number.isNaN(pos) || pos < 0) return false;
  if (pos + c.length > view.length) return false;

  for (let j = 0; j < c.length; j += 1) {
    const b = view[pos + j];
    const p = c.parts[j];
    if (p.kind === "byte") {
      if (b !== p.val) return false;
    } else if (p.kind === "range") {
      if (b < p.lo || b > p.hi) return false;
    }
  }

  // 大きさの条件。範囲外なら、そもそもその形式ではない
  if (c.minSize !== null && context.fileSize < c.minSize) {
    context.skippedSize += 1;
    return false;
  }
  if (c.maxSize !== null && context.fileSize > c.maxSize) {
    context.skippedSize += 1;
    return false;
  }

  let trailerOffset = null;
  let trailerState = "none";
  if (c.trailerParts) {
    if (!context.endSegment) {
      // ファイル末尾を見られない範囲の走査
      trailerState = "unchecked";
      if (c.requiresTrailer) {
        context.skippedTrailer += 1;
        return false;
      }
    } else {
      trailerOffset = findTrailer(context.endSegment, c.trailerParts);
      trailerState = trailerOffset === null ? "missing" : "found";
      // 「完全」を名乗るものは、終端がなければヒットさせない
      if (trailerOffset === null && c.requiresTrailer) return false;
    }
  }

  hits.push({
    id: c.id,
    name: c.name,
    offset: base + pos,
    length: c.length,
    confidence: c.confidence || 80,
    notes: "",
    trailerOffset,
    trailerState
  });
  return true;
}

/**
 * ファイル末尾から遡って、末尾の並びを探す。
 * 末尾ぴったりにあるのがふつうだが、パディングが付く形式もあるので
 * 少しだけ遡って探し、見つかった実座標を返す。
 */
const TRAILER_SEARCH_WINDOW = 64;

function findTrailer(segment, parts) {
  const view = segment.view;
  const last = view.length - parts.length;
  if (last < 0) return null;

  const stop = Math.max(0, last - TRAILER_SEARCH_WINDOW);
  for (let pos = last; pos >= stop; pos -= 1) {
    let ok = true;
    for (let j = 0; j < parts.length; j += 1) {
      const b = view[pos + j];
      const p = parts[j];
      if (p.kind === "byte" && b !== p.val) { ok = false; break; }
      if (p.kind === "range" && (b < p.lo || b > p.hi)) { ok = false; break; }
    }
    if (ok) return segment.base + pos;
  }
  return null;
}

/**
 * 相対位置のシグネチャを当てる。
 * from に指定した基準がすでにヒットしていれば、その位置 + delta だけを見る。
 * 基準の指定がないものは、これまでどおり総当たりで探す。
 */
async function scanRelative(relative, hits, context) {
  const anchored = relative.filter((c) => c.from);
  const floating = relative.filter((c) => !c.from);

  for (const c of anchored) {
    const bases = hits.filter((h) => h.id === c.from || h.name === c.from);
    for (const anchor of bases) {
      const target = anchor.offset + c.delta;
      const segment = context.segments.find((s) => target >= s.base && target < s.base + s.view.length);
      if (segment) matchAt(segment.view, c, target - segment.base, segment.base, hits, context);
    }
  }

  if (floating.length === 0) {
    self.postMessage({ type: "progress", progress: 100 });
    return;
  }

  // 基準のないものだけ、区間の中を総当たりで探す
  for (const segment of context.segments) {
    await slidingScan(segment, floating, hits, context);
  }
}

function slidingScan(segment, sigs, hits, context) {
  return new Promise((resolve) => {
    const len = segment.view.length;
    let i = 0;

    const step = () => {
      const startTime = performance.now();
      while (i < len) {
        for (const c of sigs) matchAt(segment.view, c, i, segment.base, hits, context);
        i += 1;
        if (performance.now() - startTime > 16) break;
      }
      self.postMessage({ type: "progress", progress: 80 + Math.round((i / len) * 20) });
      if (i < len) setTimeout(step, 0);
      else resolve();
    };

    step();
  });
}

function finalizeScan(hits, context, invalid) {
  const serialized = hits.map((h) => ({
    id: h.id,
    name: h.name,
    offset: h.offset,
    length: h.length,
    confidence: h.confidence,
    notes: h.notes,
    trailerOffset: typeof h.trailerOffset === "number" ? h.trailerOffset : null,
    trailerState: h.trailerState || "none"
  }));

  self.postMessage({ type: "progress", progress: 100 });
  self.postMessage({
    type: "done",
    hits: serialized,
    // 黙って落とさず、落とした理由と件数を返す
    skipped: {
      trailerUnverifiable: context.skippedTrailer,
      outOfSize: context.skippedSize,
      invalidPattern: invalid
    },
    trailerChecked: Boolean(context.endSegment)
  });
}
