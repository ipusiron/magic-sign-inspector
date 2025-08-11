// Lightweight hex viewer with virtual scrolling for large files
export class HexView {
  constructor(container){
    this.el = container;
    this.buf = null;
    this.view = null;
    this.width = 16;
    this.highlights = []; // [{start,end}]
    this.rowHeight = 24; // CSS line height in pixels
    this.visibleRows = 20; // Initial visible row count
    this.scrollTop = 0;
    this.totalRows = 0;
    
    // Selection state
    this.selection = {
      start: null,
      end: null,
      isSelecting: false
    };
    
    // Setup virtual scrolling container
    this.setupVirtualScrolling();
    this.setupContextMenu();
    this.setupSelection();
    
    // Initialize copy button states
    this.updateCopyButtonStates();
  }
  setupVirtualScrolling(){
    this.el.style.position = 'relative';
    this.el.style.overflow = 'auto';
    this.el.innerHTML = `
      <div class="hex-scroller" style="position: relative;">
        <div class="hex-content" style="position: absolute; top: 0; left: 0; width: 100%;"></div>
      </div>
    `;
    this.scroller = this.el.querySelector('.hex-scroller');
    this.content = this.el.querySelector('.hex-content');
    
    this.el.addEventListener('scroll', () => {
      this.handleScroll();
    });
    
    // Calculate visible rows based on container height
    this.updateVisibleRows();
  }
  
  setupContextMenu() {
    // DISABLED: Context menu removed per user request - copy functionality is in toolbar
    return;
    
    // Create context menu element
    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'hex-context-menu';
    this.contextMenu.innerHTML = `
      <div class="hex-context-menu-item" data-action="copy-hex">
        <span class="icon">🔖</span>
        <span>16進数をコピー</span>
        <span class="shortcut">Ctrl+C</span>
      </div>
      <div class="hex-context-menu-item" data-action="copy-ascii">
        <span class="icon">📝</span>
        <span>ASCIIをコピー</span>
        <span class="shortcut">Ctrl+Shift+C</span>
      </div>
      <div class="hex-context-menu-item" data-action="copy-bytes">
        <span class="icon">⚡</span>
        <span>生バイトをコピー</span>
        <span class="shortcut">Ctrl+Alt+C</span>
      </div>
      <div class="hex-context-menu-separator"></div>
      <div class="hex-context-menu-item" data-action="select-all">
        <span class="icon">🎯</span>
        <span>すべて選択</span>
        <span class="shortcut">Ctrl+A</span>
      </div>
      <div class="hex-context-menu-item" data-action="select-none">
        <span class="icon">⭕</span>
        <span>選択解除</span>
        <span class="shortcut">Esc</span>
      </div>
      <div class="hex-context-menu-separator"></div>
      <div class="hex-context-menu-item" data-action="jump-to-offset">
        <span class="icon">🎯</span>
        <span>オフセットへジャンプ...</span>
        <span class="shortcut">Ctrl+G</span>
      </div>
      <div class="hex-context-menu-item" data-action="find-pattern">
        <span class="icon">🔍</span>
        <span>パターンを検索...</span>
        <span class="shortcut">Ctrl+F</span>
      </div>
      <div class="hex-context-menu-separator"></div>
      <div class="hex-context-menu-item" data-action="show-info" id="context-byte-info">
        <span class="icon">ℹ️</span>
        <span>バイト情報</span>
        <span class="info-detail"></span>
      </div>
    `;
    document.body.appendChild(this.contextMenu);
    
    // Context menu event handlers
    this.contextMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.hex-context-menu-item');
      if (item) {
        const action = item.dataset.action;
        this.handleContextMenuAction(action);
        this.hideContextMenu();
      }
    });
    
    // Hide context menu on outside click
    document.addEventListener('click', (e) => {
      if (!this.contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });
    
    // Context menu disabled - prevent default right-click behavior
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Context menu functionality removed - use toolbar buttons instead
    });
  }
  
  setupSelection() {
    let isMouseDown = false;
    let startOffset = null;
    
    this.content.addEventListener('mousedown', (e) => {
      const offset = this.getOffsetFromEvent(e);
      if (offset === null) return;
      
      isMouseDown = true;
      startOffset = offset;
      this.selection.start = offset;
      this.selection.end = offset;
      this.selection.isSelecting = true;
      
      this.updateSelection();
      e.preventDefault();
    });
    
    this.content.addEventListener('mousemove', (e) => {
      if (!isMouseDown || !this.selection.isSelecting) return;
      
      const offset = this.getOffsetFromEvent(e);
      if (offset === null) return;
      
      this.selection.end = offset;
      this.updateSelection();
    });
    
    document.addEventListener('mouseup', () => {
      if (isMouseDown) {
        isMouseDown = false;
        this.selection.isSelecting = false;
      }
    });
    
    // Keyboard selection
    this.el.addEventListener('keydown', (e) => {
      this.handleKeyDown(e);
    });
    
    // Make hex view focusable
    this.el.setAttribute('tabindex', '0');
  }
  
  updateVisibleRows(){
    const containerHeight = this.el.clientHeight || 450;
    this.visibleRows = Math.ceil(containerHeight / this.rowHeight) + 2; // +2 for buffer
  }
  
  handleScroll(){
    this.scrollTop = this.el.scrollTop;
    if (this.buf) this.renderVisible();
  }
  
  setWidth(w){
    this.width = Number(w) || 16;
    if (this.buf) {
      this.totalRows = Math.ceil(this.view.length / this.width);
      this.render();
    }
  }
  
  setBuffer(arrayBuffer){
    // Memory-efficient buffer handling
    if (this.buf) {
      this.buf = null; // Clear previous buffer to free memory
      this.view = null;
    }
    
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      console.error('Invalid or empty buffer provided to setBuffer');
      return;
    }
    
    try {
      this.buf = arrayBuffer;
      this.view = new Uint8Array(arrayBuffer);
      this.totalRows = Math.ceil(this.view.length / this.width);
      
      // Use progressive rendering for large files
      if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
        this.renderProgressive();
      } else {
        this.render();
      }
    } catch (error) {
      console.error('Error setting buffer:', error);
      this.buf = null;
      this.view = null;
      this.totalRows = 0;
    }
  }
  
  clear(){
    // Enhanced memory cleanup
    if (this.buf) {
      this.buf = null;
      this.view = null;
    }
    this.highlights = [];
    this.totalRows = 0;
    this.clearSelection();
    this.content.innerHTML = "";
    this.scroller.style.height = "0px";
    
    // Force garbage collection hint (non-standard but helpful)
    if (window.gc) {
      setTimeout(() => window.gc(), 100);
    }
  }
  setHighlights(ranges){
    this.highlights = (ranges||[]).map(r=>({start:r.start,end:r.end}));
    if (this.buf) this.renderVisible();
  }
  
  scrollToOffset(off){
    const rowIndex = Math.floor(off / this.width);
    const targetScrollTop = rowIndex * this.rowHeight;
    
    // Scroll to the target position
    this.el.scrollTop = Math.max(0, targetScrollTop - this.el.clientHeight / 2);
    
    // Highlight the row after a short delay to allow rendering
    setTimeout(() => {
      const rowEl = this.content.querySelector(`[data-row="${rowIndex}"]`);
      if (rowEl){
        // Check if dark mode is active
        const isDark = document.documentElement.classList.contains('dark');
        const highlightColor = isDark ? 'rgba(34,197,94,0.2)' : 'rgba(59,130,246,0.15)';
        rowEl.style.backgroundColor = highlightColor;
        rowEl.style.transition = 'background-color 0.3s ease';
        setTimeout(() => {
          rowEl.style.backgroundColor = '';
          setTimeout(() => rowEl.style.transition = '', 300);
        }, 700);
      }
    }, 50);
  }
  
  copySelection(format) {
    if (this.selection.start === null || this.selection.end === null) {
      this.showToast('選択範囲がありません');
      return;
    }
    
    const start = Math.min(this.selection.start, this.selection.end);
    const end = Math.max(this.selection.start, this.selection.end);
    const length = end - start + 1;
    
    if (length > 10000) {
      if (!confirm(`${length.toLocaleString()} バイトをコピーしますか？`)) {
        return;
      }
    }
    
    let content = '';
    
    switch (format) {
      case 'hex':
        const hexBytes = [];
        for (let i = start; i <= end; i++) {
          hexBytes.push(this.view[i].toString(16).padStart(2, '0').toUpperCase());
        }
        content = hexBytes.join(' ');
        break;
        
      case 'ascii':
        const asciiChars = [];
        for (let i = start; i <= end; i++) {
          const b = this.view[i];
          asciiChars.push((b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.');
        }
        content = asciiChars.join('');
        break;
        
      case 'bytes':
        const bytes = new Uint8Array(this.view.buffer.slice(start, end + 1));
        content = Array.from(bytes).map(b => b.toString()).join(',');
        break;
    }
    
    navigator.clipboard.writeText(content).then(() => {
      this.showToast(`${format.toUpperCase()}形式で ${length} バイトをコピーしました`);
    }).catch(err => {
      console.error('Copy failed:', err);
      this.showToast('コピーに失敗しました');
    });
  }
  
  selectAll() {
    if (!this.view || this.view.length === 0) return;
    
    this.selection.start = 0;
    this.selection.end = this.view.length - 1;
    this.updateSelection();
    this.showToast(`${this.view.length.toLocaleString()} バイトを選択しました`);
  }
  
  clearSelection() {
    this.selection.start = null;
    this.selection.end = null;
    this.updateSelection();
  }
  
  showJumpDialog() {
    const offset = prompt('ジャンプ先オフセット (10進数または0x16進数):');
    if (!offset) return;
    
    let targetOffset = 0;
    if (offset.startsWith('0x') || offset.startsWith('0X')) {
      targetOffset = parseInt(offset, 16);
    } else {
      targetOffset = parseInt(offset, 10);
    }
    
    if (isNaN(targetOffset) || targetOffset < 0 || targetOffset >= this.view.length) {
      alert('無効なオフセットです');
      return;
    }
    
    this.scrollToOffset(targetOffset);
  }
  
  showToast(message) {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: var(--card);
      color: var(--fg);
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10001;
      font-size: 14px;
      max-width: 300px;
      animation: slideInRight 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
  render(){
    if (!this.view){ 
      this.clear(); 
      return; 
    }
    
    this.updateVisibleRows();
    
    // Set up virtual scroll container
    const totalHeight = this.totalRows * this.rowHeight;
    this.scroller.style.height = `${totalHeight}px`;
    
    // Render visible rows
    this.renderVisible();
  }
  
  renderVisible(){
    if (!this.view) return;
    
    const startRow = Math.max(0, Math.floor(this.scrollTop / this.rowHeight) - 1);
    const endRow = Math.min(this.totalRows, startRow + this.visibleRows + 2);
    
    // Build a quick lookup for highlights (only for visible range)
    const startByte = startRow * this.width;
    const endByte = Math.min(this.view.length, endRow * this.width);
    const visibleLength = endByte - startByte;
    
    // Use more efficient highlight processing
    let hi = this.buildHighlightMap(startByte, endByte, visibleLength);
    
    // Batch row rendering for better performance
    const rows = this.batchRenderRows(startRow, endRow, hi, startByte);
    
    // Position content with offset
    this.content.style.transform = `translateY(${startRow * this.rowHeight}px)`;
    this.content.innerHTML = rows.join('\n');
  }
  
  buildHighlightMap(startByte, endByte, visibleLength) {
    if (this.highlights.length === 0) return null;
    
    let hi = new Uint8Array(visibleLength);
    for (const r of this.highlights) {
      const s = Math.max(startByte, r.start|0) - startByte;
      const e = Math.min(endByte, r.end|0) - startByte;
      if (s >= 0 && e > s && s < visibleLength) {
        hi.fill(1, s, Math.min(e, visibleLength));
      }
    }
    return hi;
  }
  
  batchRenderRows(startRow, endRow, hi, startByte) {
    const rows = [];
    const BATCH_SIZE = 50; // Process rows in batches
    
    for (let batch = startRow; batch < endRow; batch += BATCH_SIZE) {
      const batchEnd = Math.min(batch + BATCH_SIZE, endRow);
      
      for (let row = batch; row < batchEnd; row++) {
        const rowStart = row * this.width;
        const rowEnd = Math.min(this.view.length, rowStart + this.width);
        
        if (rowStart >= this.view.length) break;
        
        rows.push(this.renderRow(row, rowStart, rowEnd, hi, startByte));
      }
      
      // Yield control for large batches
      if (batch + BATCH_SIZE < endRow && rows.length > 100) {
        break; // Process more in next frame
      }
    }
    
    return rows;
  }
  
  renderProgressive() {
    // Progressive rendering for very large files
    this.updateVisibleRows();
    
    const totalHeight = this.totalRows * this.rowHeight;
    this.scroller.style.height = `${totalHeight}px`;
    
    // Show loading indicator for large files
    this.showProgressiveLoading();
    
    // Render initial view
    setTimeout(() => {
      this.renderVisible();
      this.hideProgressiveLoading();
    }, 10);
  }
  
  showProgressiveLoading() {
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'hex-progressive-loading';
    loadingDiv.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--card);
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
      font-size: 14px;
      color: var(--fg);
    `;
    loadingDiv.textContent = 'HEXビューを準備中...';
    this.el.appendChild(loadingDiv);
  }
  
  hideProgressiveLoading() {
    const loading = this.el.querySelector('#hex-progressive-loading');
    if (loading) loading.remove();
  }
  
  renderRow(rowIndex, start, end, hiArray, hiOffset){
    const off = start.toString(16).padStart(8,"0");
    
    // Enhanced hex rendering with selection support
    const hexBytes = [];
    const asciiChars = [];
    
    for (let i = start; i < end; i++){
      const b = this.view && this.view[i] !== undefined ? this.view[i] : 0;
      const hex = b.toString(16).padStart(2,"0").toUpperCase();
      const isHighlighted = hiArray && hiArray[i - hiOffset];
      const isSelected = this.isOffsetSelected(i);
      
      let hexClass = 'hex-byte';
      let asciiClass = 'hex-ascii-char';
      
      if (isSelected) {
        hexClass += ' hex-selected';
        asciiClass += ' hex-selected';
      } else if (isHighlighted) {
        hexClass += ' hi';
        asciiClass += ' hi';
      }
      
      hexBytes.push(`<span class="${hexClass}" data-offset="${i}">${hex}</span>`);
      
      const ascii = (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : '.';
      asciiChars.push(`<span class="${asciiClass}" data-offset="${i}">${ascii}</span>`);
    }
    
    // Padding for incomplete rows
    const padding = this.width - (end - start);
    if (padding > 0) {
      for (let p = 0; p < padding; p++) {
        hexBytes.push('<span class="hex-byte-padding">  </span>');
      }
    }
    
    return `<div class="hex-row" data-row="${rowIndex}">` +
           `<span class="hex-off">0x${off}</span>` +
           `<span class="hex-data">${hexBytes.join(' ')}</span>` +
           `<span class="hex-ascii">${asciiChars.join('')}</span>` +
           '</div>';
  }
  
  getOffsetFromEvent(e) {
    const target = e.target.closest('[data-offset]');
    if (!target) return null;
    return parseInt(target.dataset.offset, 10);
  }
  
  isOffsetSelected(offset) {
    if (this.selection.start === null || this.selection.end === null) return false;
    const start = Math.min(this.selection.start, this.selection.end);
    const end = Math.max(this.selection.start, this.selection.end);
    return offset >= start && offset <= end;
  }
  
  updateSelection() {
    // Re-render visible area to update selection styling
    if (this.view) {
      this.renderVisible();
    }
    
    // Update copy button states
    this.updateCopyButtonStates();
  }
  
  updateCopyButtonStates() {
    const hasSelection = this.selection.start !== null && this.selection.end !== null;
    const copyButtons = ['#copyHexBtn', '#copyAsciiBtn', '#copyBytesBtn'];
    
    copyButtons.forEach(selector => {
      const button = document.querySelector(selector);
      if (button) {
        button.disabled = !hasSelection;
      }
    });
  }
  
  showContextMenu(x, y, clickOffset = null) {
    // DISABLED: Context menu functionality removed
    return;
    
    copyItems.forEach(item => {
      if (hasSelection) {
        item.classList.remove('disabled');
      } else {
        item.classList.add('disabled');
      }
    });
    
    // Update byte info if we have a specific offset
    if (clickOffset !== null && this.view && clickOffset < this.view.length) {
      const byteValue = this.view[clickOffset];
      const infoItem = this.contextMenu.querySelector('#context-byte-info .info-detail');
      if (infoItem) {
        infoItem.textContent = `0x${byteValue.toString(16).toUpperCase().padStart(2, '0')} (${byteValue})`;
      }
    }
    
    // Position and show menu
    this.contextMenu.style.left = `${x}px`;
    this.contextMenu.style.top = `${y}px`;
    
    // Ensure menu stays within viewport
    const rect = this.contextMenu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    if (rect.right > viewportWidth) {
      this.contextMenu.style.left = `${viewportWidth - rect.width - 10}px`;
    }
    if (rect.bottom > viewportHeight) {
      this.contextMenu.style.top = `${viewportHeight - rect.height - 10}px`;
    }
    
    this.contextMenu.classList.add('show');
  }
  
  hideContextMenu() {
    // DISABLED: Context menu functionality removed
    return;
  }
  
  handleContextMenuAction(action) {
    switch (action) {
      case 'copy-hex':
        this.copySelection('hex');
        break;
      case 'copy-ascii':
        this.copySelection('ascii');
        break;
      case 'copy-bytes':
        this.copySelection('bytes');
        break;
      case 'select-all':
        this.selectAll();
        break;
      case 'select-none':
        this.clearSelection();
        break;
      case 'jump-to-offset':
        this.showJumpDialog();
        break;
    }
  }
  
  handleKeyDown(e) {
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrlKey = isMac ? e.metaKey : e.ctrlKey;
    
    if (ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      if (e.shiftKey) {
        this.copySelection('ascii');
      } else if (e.altKey) {
        this.copySelection('bytes');
      } else {
        this.copySelection('hex');
      }
    } else if (ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selectAll();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.clearSelection();
    } else if (ctrlKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      this.showJumpDialog();
    }
  }
}
