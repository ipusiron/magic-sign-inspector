// エントロピーを区間ごとに測る。DOMに触れないのでテストできる。

/** 1つの区間のShannonエントロピー（0〜8 bits/byte） */
export function entropyOf(view, start = 0, end = view.length) {
  const from = Math.max(0, start);
  const to = Math.min(view.length, end);
  const length = to - from;
  if (length <= 0) return 0;

  const freqs = new Uint32Array(256);
  for (let i = from; i < to; i += 1) freqs[view[i]] += 1;

  let entropy = 0;
  for (let i = 0; i < 256; i += 1) {
    const count = freqs[i];
    if (count === 0) continue;
    const p = count / length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * ファイルを等間隔に分けて、それぞれのエントロピーを返す。
 *
 * 全体で1つの値しか出さないと、「前半はテキスト、後半は暗号化」のような
 * 切れ目が平均に埋もれてしまう。分けて見ると、その境目が目で分かる。
 */
export function blockEntropies(view, blocks = 128, minBlockSize = 512) {
  if (!view || !view.length) return [];
  // 区間が小さすぎると、値は「偏り」ではなく「標本の少なさ」で下がる。
  // 256通りのバイトに対して242バイトしかなければ、
  // ランダムなデータでも 7.1 程度にしかならず、圧縮や暗号化に見えなくなる。
  const byMinSize = Math.max(1, Math.floor(view.length / minBlockSize));
  const count = Math.max(1, Math.min(blocks, byMinSize, view.length));
  const size = view.length / count;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const start = Math.floor(i * size);
    const end = i === count - 1 ? view.length : Math.floor((i + 1) * size);
    out.push({ start, end, value: entropyOf(view, start, end) });
  }
  return out;
}

/**
 * 値を、意味の分かる区分に置き換える。
 * 数字だけでは「7.2は高いのか」が分からない。
 */
export function entropyBand(value) {
  if (value < 1) return "flat";      // 同じ値の繰り返し。パディングや未使用領域
  if (value < 4) return "low";       // 構造のあるデータ。ヘッダー、表、単純な形式
  if (value < 6.5) return "text";    // 文章やコードなど
  if (value < 7.5) return "mixed";   // 圧縮されたものが混じる
  return "high";                     // 圧縮か暗号化。ほぼ偏りがない
}

/** グラフの中で、値が飛んでいる境目を見つける */
export function findJumps(blocks, threshold = 2) {
  const jumps = [];
  for (let i = 1; i < blocks.length; i += 1) {
    const diff = blocks[i].value - blocks[i - 1].value;
    if (Math.abs(diff) >= threshold) {
      jumps.push({ at: blocks[i].start, from: blocks[i - 1].value, to: blocks[i].value, rising: diff > 0 });
    }
  }
  return jumps;
}
