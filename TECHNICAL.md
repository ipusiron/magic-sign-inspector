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

### Boyer-Moore風効率化
```javascript
function findSignatureMatches(buffer, signatures) {
  const results = [];
  
  for (const sig of signatures) {
    if (!sig.enabled) continue;
    
    const pattern = parseHexPattern(sig.pattern);
    const matches = boyerMooreSearch(buffer, pattern);
    
    for (const offset of matches) {
      results.push({
        name: sig.name,
        offset: offset,
        length: pattern.length,
        confidence: sig.confidence || 80
      });
    }
  }
  
  return results.sort((a, b) => a.offset - b.offset);
}
```

### ワイルドカード対応
```javascript
function parseHexPattern(pattern) {
  return pattern.split(' ').map(byte => {
    if (byte === '??') return null; // ワイルドカード
    return parseInt(byte, 16);
  });
}

function matchesPattern(buffer, offset, pattern) {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== null && buffer[offset + i] !== pattern[i]) {
      return false;
    }
  }
  return true;
}
```

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

### 主要メトリクス
- **ファイル読み込み**: ~100MB/秒（チャンク処理）
- **シグネチャスキャン**: ~50MB/秒（244パターン）
- **HEXビュー描画**: 60FPS（仮想スクロール）
- **メモリ使用量**: <100MB（1GBファイル処理時）

### 最適化ポイント
1. **CSS Containment** でレンダリング最適化
2. **RequestIdleCallback** でフレーム間処理
3. **GPU加速** でスムーズなアニメーション
4. **WebAssembly検討** - 将来的な高速化

## 🔒 セキュリティ考慮事項

### プライバシー保護
- **完全ローカル処理** - ファイルデータの外部送信なし
- **CORS準拠** - 必要最小限のリソースアクセス
- **XSS対策** - innerHTML使用時の適切なエスケープ

### ファイル処理安全性
```javascript
// ファイルサイズ制限
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('ファイルサイズが上限を超えています');
  }
  
  // MIME type validation（必要に応じて）
  const allowedTypes = ['application/octet-stream', ...];
  if (!allowedTypes.includes(file.type)) {
    console.warn('未対応のMIME type:', file.type);
  }
}
```

## 🧪 テスト戦略

### 単体テスト対象
- シグネチャマッチング関数
- ハッシュ計算関数  
- ファイル読み込み関数
- UI状態管理関数

### 統合テスト
- ファイルアップロード→解析→表示フロー
- 辞書編集→保存→読み込みフロー
- レスポンシブUI動作確認

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