# 開発メモ・トラブルシューティング

## 📝 UI統合における重複コピー機能問題

### 発生した問題
開発過程でHEXビューにコピー機能を追加した際、ページ下部に意図しないフローティングコピーメニューが残存し続ける問題が発生しました。

#### 問題の詳細

**症状**:
- HEXビューツールバーにコピーボタン（HEX/ASCII/RAW）を正常に追加済み
- しかし、ページ下部にフローティングコンテキストメニューが固定表示される
- 以下の項目が画面下部に残存：
  - 📋 16進数をコピー (Ctrl+C)
  - 📋 ASCIIをコピー (Ctrl+Shift+C)
  - ⚡ 生バイトをコピー (Ctrl+Alt+C)
  - 🎯 すべて選択 (Ctrl+A)
  - ⭕ 選択解除 (Esc)
  - 🎯 オフセットへジャンプ... (Ctrl+G)
  - 🔍 パターンを検索... (Ctrl+F)
  - ℹ️ バイト情報

**原因分析**:
1. **HEXビューコンテキストメニューの設計**  
   - `hexview.js`の`setupContextMenu()`でコンテキストメニューを`document.body`に追加
   - 右クリック時にのみ表示される想定だったが、何らかの理由で常時表示状態になっていた

2. **JavaScript削除処理の不完全性**  
   - `cleanupFooterCopyUI()`関数で削除を試みたが、コンテキストメニューの動的生成タイミングにより削除しきれなかった
   - 削除対象の特定が不十分だった

3. **CSS強制非表示の不足**  
   - `.hex-context-menu`クラスに対する強制非表示ルールが不足していた

#### 解決手順

**Step 1: JavaScript レベルでの完全無効化**
```javascript
// hexview.js - setupContextMenu()メソッド
setupContextMenu() {
  // DISABLED: Context menu removed per user request - copy functionality is in toolbar
  return;
  // ... 既存のコンテキストメニュー作成コードは無効化
}
```

**Step 2: 既存要素の削除強化**
```javascript
// app.js - cleanupFooterCopyUI()
// Remove any existing context menu elements
const contextMenus = document.querySelectorAll('.hex-context-menu');
contextMenus.forEach(menu => {
  console.log('Removing context menu:', menu);
  menu.remove();
});
```

**Step 3: CSS による強制非表示**
```css
/* style.css - Force hide rules */
.hex-context-menu {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
```

**Step 4: イベントハンドラーの修正**
```javascript
// hexview.js - 右クリックイベント
this.el.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // Context menu functionality removed - use toolbar buttons instead
});
```

#### 学んだ教訓

1. **UI重複の危険性**  
   - 複数の方法で同じ機能を提供する場合、古い実装の完全な無効化が重要
   - 段階的な移行では中途半端な状態が残りやすい

2. **DOM要素の生存期間管理**  
   - `document.body`に追加した要素は明示的に削除しない限り残存する
   - 動的生成される要素の削除タイミングに注意が必要

3. **多層防御の重要性**  
   - JavaScript無効化 + DOM削除 + CSS強制非表示の組み合わせが効果的
   - 単一の対策では不完全な場合がある

4. **ユーザーフィードバックの価値**  
   - スクリーンショットによる具体的な問題報告により、根本原因を迅速に特定できた
   - 「何度指摘しても修正されていない」という継続的な報告が完全な解決につながった

#### 今後の注意点

- UI機能の統合・移行時は、古い実装の完全削除を必ず確認する
- 複数のアプローチ（JavaScript + CSS + DOM操作）で確実に無効化する
- ユーザーテストやスクリーンショットによる検証を重視する
- 段階的な開発では中間状態での動作確認を怠らない

## 🎨 ヘッダー中央揃え問題

### 問題
ヘッダー内のコンテンツ（タイトル、ロゴ、説明）が左寄りになる問題。

### 原因
`max-width: 1700px` がワイドスクリーンで左寄りレイアウトを引き起こしていた。

### 解決策
```css
.app-header > div:first-child {
  justify-content: center; /* ブランド要素を中央配置 */
  position: relative; /* アクション要素の絶対配置のベース */
}

.header-actions {
  position: absolute;
  right: 18px; /* 右端に配置 */
  top: 50%;
  transform: translateY(-50%); /* 垂直中央揃え */
}
```

## 📋 パフォーマンス最適化の経緯

### 大容量ファイル問題
画像ファイル読み込み時のパフォーマンス低下に対する対策：

1. **チャンク読み込み** - 50MB以上のファイル用
2. **WebWorker活用** - UI応答性の維持
3. **仮想スクロール** - HEXビューの効率化
4. **プログレッシブ描画** - 段階的な表示

### シグネチャ辞書の拡充
- 基本91種 → 244種への拡張
- カテゴリ別分離（enhanced.json、forensics.json等）
- トレーラーシグネチャ対応

## 🔧 開発環境とツール

### 推奨開発サーバー
```bash
# Python（もっとも簡単）
python -m http.server 8080

# Node.js
npx http-server -p 8080

# VS Code Live Server拡張も推奨
```

### デバッグ手法
```javascript
// パフォーマンス計測
console.time('operation');
// ... 処理
console.timeEnd('operation');

// メモリ使用量監視
console.log('Memory:', performance.memory?.usedJSHeapSize);
```

## 🎯 今後の開発指針

### 優先順位
1. **機能安定性** - 既存機能の品質向上
2. **ユーザビリティ** - UI/UX の継続改善
3. **パフォーマンス** - 必要に応じた最適化
4. **新機能** - ユーザーニーズに基づく拡張

### コード品質
- **段階的リファクタリング** - 大規模変更は避ける
- **テスト重視** - 重要機能の動作確認
- **ドキュメント充実** - 変更の記録と共有

## 🐛 既知の制限事項

### ブラウザ制限
- **ファイルサイズ** - ブラウザメモリ制限（通常1-2GB）
- **WebWorker** - 一部古いブラウザで制限
- **CORS** - file://プロトコル非対応

### パフォーマンス制限
- **巨大ファイル** - 10GB+では動作が重い
- **大量シグネチャ** - 1000+パターンで検索が遅延
- **同時処理** - 複数ファイル同時解析は未対応

## 📊 開発メトリクス

### コードベース規模
- JavaScript: ~2,600行
- CSS: ~2,200行  
- HTML: ~700行
- 総計: ~5,500行

### 機能カバレッジ
- シグネチャ形式: 244種
- ファイル形式: 15+カテゴリ
- UI要素: レスポンシブ完全対応
- ブラウザ対応: Modern browsers（ES2020+）