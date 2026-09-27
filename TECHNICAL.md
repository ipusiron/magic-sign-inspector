# MagicSign Inspector - 技術仕様書

## 🏗️ アーキテクチャ概要

### システム構成
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend SPA  │    │   WebWorker     │    │ LocalStorage    │
│                 │    │                 │    │                 │
│ • Vue.js風 UI   │    │ • ファイル処理  │    │ • 辞書キャッシュ │
│ • CSS Grid      │◄──►│ • ハッシュ計算  │    │ • 設定保存      │
│ • レスポンシブ  │    │ • 大容量対応    │    │ • 履歴管理      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### パフォーマンス最適化

#### 1. 大容量ファイル処理
```javascript
// チャンク読み込み（50MB以上）
function readFileInChunks(file, chunkSize = 10 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let offset = 0;
    
    function readNextChunk() {
      const chunk = file.slice(offset, offset + chunkSize);
      const reader = new FileReader();
      
      reader.onload = (e) => {
        chunks.push(new Uint8Array(e.target.result));
        offset += chunkSize;
        
        if (offset < file.size) {
          setTimeout(readNextChunk, 0); // Yield control
        } else {
          resolve(mergeChunks(chunks));
        }
      };
      
      reader.readAsArrayBuffer(chunk);
    }
    
    readNextChunk();
  });
}
```

#### 2. 仮想スクロール実装
```javascript
// HEXビューでの効率的な描画
class VirtualHexView {
  renderVisible() {
    const startRow = Math.floor(this.scrollTop / this.rowHeight);
    const endRow = Math.min(this.totalRows, startRow + this.visibleRows);
    
    // 必要な行のみレンダリング
    const rows = this.batchRenderRows(startRow, endRow);
    this.content.innerHTML = rows.join('\\n');
  }
  
  batchRenderRows(startRow, endRow) {
    const BATCH_SIZE = 50;
    const rows = [];
    
    for (let batch = startRow; batch < endRow; batch += BATCH_SIZE) {
      // バッチ処理でUI応答性を維持
      if (rows.length > 100) break; // メモリ制限
    }
    
    return rows;
  }
}
```

#### 3. WebWorker活用
```javascript
// worker.js - バックグラウンド処理
self.onmessage = function(e) {
  const { type, data } = e.data;
  
  switch (type) {
    case 'SCAN_FILE':
      const results = scanFileForSignatures(data.buffer, data.signatures);
      self.postMessage({ type: 'SCAN_COMPLETE', results });
      break;
      
    case 'CALCULATE_HASH':
      const hashes = calculateAllHashes(data.buffer);
      self.postMessage({ type: 'HASH_COMPLETE', hashes });
      break;
  }
};
```

## 🎨 UI/UX 設計原則

### レスポンシブデザイン
```css
/* モバイルファースト設計 */
.layout {
  display: flex;
  flex-direction: column;
  padding: 8px 12px; /* モバイル基準 */
}

/* タブレット対応 */
@media (min-width: 768px) {
  .layout {
    padding: 16px 20px;
  }
  
  .inspect-grid {
    grid-template-columns: 1fr 1fr;
  }
}

/* デスクトップ対応 */
@media (min-width: 1024px) {
  .layout {
    padding: 20px 40px;
  }
  
  .inspect-grid {
    grid-template-columns: 2fr 3fr;
  }
}
```

### ダークモード実装
```css
:root {
  --bg: #ffffff;
  --fg: #1f2937;
  --accent: #2563eb;
}

:root.dark {
  --bg: #111827;
  --fg: #f9fafb;
  --accent: #60a5fa;
}

/* CSS変数による一元管理 */
.card {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
}
```

## 🔍 シグネチャ検索アルゴリズム

### 照合の作り

Boyer-Moore は使っていない。パターンごとに、走査対象の全位置を順に見る素朴な照合である。
シグネチャのほとんどが数バイトで、`??` や `[00-1F]` を含むため、
スキップ表を作る手間に見合う速さが出ないと判断した（20MB・181件で約0.6秒。「パフォーマンス計測」を参照）。

パターンは、照合の前に3種類の部品へ変換する。

```javascript
// js/worker.js
function compileParts(pattern) {
  const toks = (pattern || "").trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) throw ...;
  return toks.map((tok) => {
    if (/^\?\?$/.test(tok)) return { kind: "any" };                       // 任意の1バイト
    const mRange = tok.match(/^\[([0-9A-Fa-f]{2})-([0-9A-Fa-f]{2})\]$/);
    if (mRange) return { kind: "range", lo: ..., hi: ... };               // 範囲
    if (/^[0-9A-Fa-f]{2}$/.test(tok)) return { kind: "byte", val: ... };  // 固定
    throw ...;                                                            // それ以外は受け付けない
  });
}
```

照合は `matchAt(view, c, pos, base, hits, context)` で行う。区間の中の位置 `pos` で合わせ、
報告するときは `base` を足して実座標に直す。「先頭＋末尾」の走査で末尾側のヒットが
区間の先頭からの値になる不具合は、この `base` で解消している。

### オフセットの種類

| 種類 | 動き |
|------|------|
| `absolute` | ファイル先頭から `value` バイトの位置だけを見る |
| `relative` | `from` で指したシグネチャのヒット位置に `delta` を足した位置を見る |
| 指定なし | 走査した範囲の全位置を順に見る |

### 終端（トレーラー）の扱い

`trailer` を持つシグネチャは、ファイル末尾の並びも照合し、結果を `trailerState` として返す。

| 値 | 意味 |
|----|------|
| `found` | 終端の並びがあった |
| `missing` | 期待した終端が無い（途中で切れた可能性） |
| `unchecked` | 末尾を読まない範囲の走査なので判定していない |
| `none` | このシグネチャは終端を持たない |

**終端が無いことを理由にヒットを取り消すのは、`requires_trailer` を立てたものだけである。**
既定の辞書では JPEG (SOI) にも `trailer` が書かれており、一律に取り消すと
「途中で切れたJPEG」が1件も検出されなくなる。壊れたファイルを見つけることこそが
フォレンジックでの用途なので、既定では報告に留める。

## 🗄️ データ管理

### LocalStorage活用
```javascript
class DictionaryManager {
  saveDictionary(dict) {
    const compressed = this.compressDict(dict);
    localStorage.setItem('magicsign_dict', JSON.stringify(compressed));
  }
  
  loadDictionary() {
    const saved = localStorage.getItem('magicsign_dict');
    return saved ? this.decompressDict(JSON.parse(saved)) : null;
  }
  
  compressDict(dict) {
    // 冗長なデータを削除してストレージ効率化
    return {
      version: dict.version,
      entries: dict.entries.map(e => ({
        id: e.id,
        n: e.name,
        p: e.pattern,
        c: e.category,
        e: e.enabled
      }))
    };
  }
}
```

## 🚀 パフォーマンス計測

### 実測値

20MBのファイル（ランダムな内容、先頭にJPEGのSOI、末尾にEOI）を、既定の辞書（有効な181件）で走査した。
Playwright から Chromium（ヘッドレス）で測っている。

| 項目 | 実測 |
|------|------|
| 読み込み＋MD5/SHA1/SHA256 | 624 ms |
| 走査 | 571 ms（約35MB/秒） |
| 検出 | 3件 |

- 環境で変わる数字なので、目安として読むこと。
- ハッシュは Web Crypto（SHA1/SHA256）と自前のMD5で、走査とは別に進む。
- メモリ使用量とHEXビューのフレームレートは測っていないため、ここには書かない。

### 最適化ポイント
1. **CSS containment** で、大きな表とHEXビューの再描画範囲を狭める
2. **requestIdleCallback** で、ハッシュとエントロピーの計算を空き時間へ回す
3. **仮想スクロール** で、表示している行だけをDOMに置く
4. **Web Worker** で、走査を別スレッドへ出す

## 🔒 セキュリティ考慮事項

### プライバシー保護
- **完全ローカル処理** - ファイルデータの外部送信なし
- **CORS準拠** - 必要最小限のリソースアクセス
- **XSS対策** - innerHTML使用時の適切なエスケープ

### ファイル処理

ファイルサイズの上限は設けていない。代わりに、走査する範囲を利用者が選ぶ。

```javascript
// 走査の範囲は 先頭64MB / 先頭128MB / 先頭＋末尾 / 全文 から選ぶ。
// 「先頭＋末尾」は2つの区間を、それぞれの実座標（base）を添えて Worker へ渡す。
// base を持たせないと、末尾側のヒットのオフセットが区間の先頭からの値になってしまう。
worker.postMessage({ cmd: "scan", fileSize, segments: [{ buffer, base }], signatures });

// 全文を選んだとき、100MBを超えるファイルでは時間がかかる旨を確かめる
if (fileSize > 100 * 1024 * 1024 && scope === "full") {
  if (!confirm(t("toast.confirmFull", { mb: (fileSize/1024/1024).toFixed(1) }))) return;
}
```

旧版のこの節には `MAX_FILE_SIZE` と `validateFile()` のコードが載っていたが、実装には無い。
MIME type による絞り込みも行っていない。拡張子やMIME typeを信じないことがこのツールの主旨なので、
読み込む側で MIME type を見て弾く作りにはしない。

## 🧪 テスト

依存パッケージを増やさず、Node 同梱の `node --test` で回す。

```bash
npm test
```

| ファイル | 見るもの |
|----------|----------|
| `test/scan.test.js` | 走査、終端の照合、相対オフセット、サイズの条件、読めないパターンを飛ばす動き |
| `test/dict.test.js` | インポートした辞書の検証（知らない項目を持ち越さないことを含む） |
| `test/foremost.test.js` | foremost.conf の読み書き。範囲指定は扱えないと返すこと |
| `test/i18n.test.js` | 日英でキーの集合と差し込みが一致すること、HTMLとスクリプトが指すキーが辞書にあること |

Worker は素のスクリプトなので、`new Function` で読み込んで関数を取り出す（`test/helper.js`）。
`i18n.js` も同じ方法で読むため、`window` も `localStorage` も無い環境で読めることが、
このテスト自体で確かめられている。

ブラウザーでしか確かめられないもの（配色のコントラスト、タップ領域、狭い画面での折り返し、
CSP違反の有無）は、Playwright で状態を作ってから測っている。自動テストには入れていない。

## 📊 メモリ管理

### ガベージコレクション対策
```javascript
class BufferManager {
  setBuffer(arrayBuffer) {
    // 古いバッファを明示的に削除
    if (this.currentBuffer) {
      this.currentBuffer = null;
    }
    
    this.currentBuffer = arrayBuffer;
    
    // GCヒント（非標準だが有効）
    if (window.gc) {
      setTimeout(() => window.gc(), 100);
    }
  }
  
  cleanup() {
    this.currentBuffer = null;
    this.view = null;
    // 関連するUIも削除
    this.clearDisplay();
  }
}
```

## 🔧 デバッグ・診断

### パフォーマンス計測
```javascript
function measurePerformance(operation) {
  const start = performance.now();
  const result = operation();
  const end = performance.now();
  
  console.log(`Operation took ${end - start}ms`);
  return result;
}

// 使用例
const scanResults = measurePerformance(() => 
  scanFileForSignatures(buffer, signatures)
);
```

### エラートラッキング
```javascript
window.addEventListener('error', (event) => {
  console.error('Runtime error:', {
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    column: event.colno
  });
});
```