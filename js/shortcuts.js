// キーボードショートカット。
// 以前は index.html のインラインスクリプトに置かれており、
// app.js が type="module" で読み込まれるため window.STATE が存在せず、
// ここの処理はすべて黙って素通りしていた（実測で typeof window.STATE === "undefined"）。
// 外部ファイルへ出し、app.js が公開する取得関数を使う。
// インラインを残したままだと CSP で script-src 'self' にできない。

/** HEXビューを取り出す。まだ用意できていなければ null */
function getHex() {
  return (window.MSI && window.MSI.hex) || null;
}


    // キーボードショートカット
    document.addEventListener('keydown', (e) => {
      // Skip if user is typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }
      
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      
      // File open: Ctrl/Cmd + O
      if ((isMac && e.metaKey && e.key.toLowerCase() === 'o') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 'o')) {
        e.preventDefault();
        document.getElementById('fileInput').click();
      }
      
      // Help: ? key
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        // Switch to settings/help tab
        const helpTab = document.querySelector('[data-tab="settings"]');
        if (helpTab) {
          helpTab.click();
        }
      }
      
      // Navigate to signatures search: /
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const sigTab = document.querySelector('[data-tab="signatures"]');
        const searchInput = document.getElementById('sigSearch');
        if (sigTab && searchInput) {
          sigTab.click();
          setTimeout(() => searchInput.focus(), 100);
        }
      }
      
      // Edit selected signature: E
      if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const editTab = document.querySelector('[data-tab="edit"]');
        if (editTab) {
          editTab.click();
        }
      }
      
      // Next/Previous hit navigation: F/Shift+F
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (e.shiftKey) {
          document.getElementById('jumpPrev')?.click();
        } else {
          document.getElementById('jumpNext')?.click();
        }
      }
      
      // Jump to offset: G
      if (e.key.toLowerCase() === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const jumpInput = document.getElementById('jumpOffset');
        if (jumpInput) {
          jumpInput.focus();
          jumpInput.select();
        }
      }
      
      // HEX view keyboard shortcuts (when hex view is active)
      const currentTab = document.querySelector('.main-tab.active')?.dataset?.tab;
      if (currentTab === 'inspect') {
        const hexView = document.getElementById('hexView');
        
        // Copy hex: Ctrl+C 
        if ((isMac && e.metaKey && e.key.toLowerCase() === 'c') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 'c')) {
          // Check if we're in a text input field
          if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.isContentEditable) {
            e.preventDefault();
            // Trigger HEX view copy functionality
            if (getHex()) {
              if (e.shiftKey) {
                getHex().copySelection('ascii');
              } else if (e.altKey) {
                getHex().copySelection('bytes');
              } else {
                getHex().copySelection('hex');
              }
            }
          }
        }
        
        // Select all in hex view: Ctrl+A
        if ((isMac && e.metaKey && e.key.toLowerCase() === 'a') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 'a')) {
          if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.isContentEditable) {
            e.preventDefault();
            if (getHex()) {
              getHex().selectAll();
            }
          }
        }
        
        // Jump to offset in hex view: Ctrl+G
        if ((isMac && e.metaKey && e.key.toLowerCase() === 'g') || (!isMac && e.ctrlKey && e.key.toLowerCase() === 'g')) {
          if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.isContentEditable) {
            e.preventDefault();
            if (getHex()) {
              getHex().showJumpDialog();
            }
          }
        }
      }
    });
  