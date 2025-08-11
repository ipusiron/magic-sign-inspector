import { HexView } from "./hexview.js";

const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

let STATE = {
  dict: { version:"1.0", entries:[] },
  selectedId: null,
  file: null,
  buffer: null,
  worker: null,
  hex: null,
  hits: [],
  selectedHitIndex: null, // -1 = no selection (show all), null = no hits, >=0 = specific hit
  theme: (localStorage.getItem("msi_theme") || "auto")
};

window.addEventListener("DOMContentLoaded", init);

async function init(){
  // Theme
  applyTheme(STATE.theme);
  qs("#toggleTheme").checked = document.documentElement.classList.contains("dark");
  qs("#toggleTheme").addEventListener("change", onToggleTheme);

  // HexView
  STATE.hex = new HexView(qs("#hexView"));

  // Tabs
  qsa(".main-tab").forEach(btn=>btn.addEventListener("click", onTab));

  // File open
  qs("#openFileBtn").addEventListener("click", ()=>qs("#fileInput").click());
  qs("#fileInput").addEventListener("change", onFileInput);

  // DnD
  const drop = qs("#dropArea");
  ;["dragenter","dragover"].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault(); drop.classList.add("drag");}));
  ;["dragleave","drop"].forEach(ev=>drop.addEventListener(ev, e=>{e.preventDefault(); drop.classList.remove("drag");}));
  drop.addEventListener("drop", onDrop);

  // Controls
  qs("#startScanBtn").addEventListener("click", startScan);
  qs("#cancelScanBtn").addEventListener("click", cancelScan);
  qs("#hexWidth").addEventListener("change", e=>STATE.hex.setWidth(e.target.value));
  qs("#jumpGo").addEventListener("click", onJump);
  qs("#jumpPrev").addEventListener("click", ()=>jumpHit(-1));
  qs("#jumpNext").addEventListener("click", ()=>jumpHit(+1));
  
  // Copy buttons
  qs("#copyHexBtn").addEventListener("click", ()=>STATE.hex.copySelection('hex'));
  qs("#copyAsciiBtn").addEventListener("click", ()=>STATE.hex.copySelection('ascii'));
  qs("#copyBytesBtn").addEventListener("click", ()=>STATE.hex.copySelection('bytes'));

  // Sig buttons
  qs("#addSignatureBtn").addEventListener("click", onAddSig);
  qs("#duplicateSignatureBtn").addEventListener("click", onDupSig);
  qs("#deleteSignatureBtn").addEventListener("click", onDelSig);
  qs("#sigSearch").addEventListener("input", renderSigTable);
  qs("#filterEnabled").addEventListener("change", renderSigTable);
  qs("#filterCategory").addEventListener("change", renderSigTable);

  // Edit form
  qs("#sigForm").addEventListener("submit", onSaveSig);
  qs("#resetSigBtn").addEventListener("click", syncEditForm);
  qs("#testSigBtn").addEventListener("click", onPreviewPattern);

  // Dictionary I/O
  qs("#importBtn").addEventListener("click", onImport);
  qs("#exportJsonBtn").addEventListener("click", ()=>exportJson(getExportEntries()));
  qs("#exportForemostBtn").addEventListener("click", ()=>exportForemost(getExportEntries()));

  // Settings
  qs("#setHexWidth").addEventListener("change", e=>{STATE.hex.setWidth(e.target.value); qs("#hexWidth").value = e.target.value;});
  qs("#setAutosave").addEventListener("change", saveLocal);
  qs("#setFollowOS").addEventListener("change", saveLocal);

  // Mobile touch improvements
  initMobileTouchHandlers();
  
  // File info hash copy buttons
  setupFileInfoHandlers();
  
  // Load default dict
  await loadDefaultDict();
  renderSigTable();
  
  // Remove any footer copy UI that might be lingering
  cleanupFooterCopyUI();
}

/* ------------ Footer Copy UI Cleanup ------------ */
function cleanupFooterCopyUI() {
  // Ensure DOM is ready
  if (!document.body) {
    setTimeout(cleanupFooterCopyUI, 100);
    return;
  }

  try {
    // Only target elements that are positioned at the bottom or have suspicious copy-related classes
    const suspiciousCopyElements = document.querySelectorAll(`
      [style*="position:fixed"][style*="bottom"],
      [style*="position: fixed"][style*="bottom"], 
      [class*="copy-ui"], 
      [class*="floating-copy"], 
      [id*="copy-ui"], 
      [id*="floating-copy"], 
      [class*="copy-toolbar"],
      [class*="copy-floating"],
      [class*="bottom-copy"]
    `);
    
    suspiciousCopyElements.forEach(el => {
      try {
        // Double-check it's not our legitimate copy buttons
        if (!el.closest('.hex-copy-buttons') && !el.closest('.hex-context-menu')) {
          console.log('Removing suspicious positioned copy element:', el.tagName, el.className);
          el.remove();
        }
      } catch (e) {
        console.warn('Failed to remove suspicious element:', e);
      }
    });
    
    // Remove any fixed positioned elements that might be copy UI
    const fixedElements = document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]');
    fixedElements.forEach(el => {
      try {
        const style = el.style.cssText.toLowerCase();
        if (style.includes('bottom') && (
            (el.textContent && el.textContent.includes('コピー')) || 
            el.classList.toString().includes('copy') ||
            el.id.includes('copy')
          )) {
          console.log('Removing fixed copy UI element:', el);
          el.remove();
        }
      } catch (e) {
        console.warn('Failed to process fixed element:', e);
      }
    });
    
    // Remove any elements with copy-related class names or IDs
    const suspiciousElements = document.querySelectorAll(
      '[class*="copy-ui"], [class*="floating-copy"], [id*="copy-ui"], [id*="floating-copy"], [class*="copy-toolbar"]'
    );
    suspiciousElements.forEach(el => {
      try {
        if (!el.closest('.hex-copy-buttons') && !el.closest('.hex-context-menu')) {
          console.log('Removing suspicious copy UI element:', el);
          el.remove();
        }
      } catch (e) {
        console.warn('Failed to remove suspicious element:', e);
      }
    });
    
    // Remove any existing context menu elements
    const contextMenus = document.querySelectorAll('.hex-context-menu');
    contextMenus.forEach(menu => {
      console.log('Removing context menu:', menu);
      menu.remove();
    });

    // Set up MutationObserver for dynamic content with copy-related texts
    const copyTexts = ['16進数をコピー', 'ASCIIをコピー', '生バイトをコピー', 'コピー', 'copy'];
    setupCopyUIObserver(copyTexts);
    
  } catch (error) {
    console.warn('Error in cleanupFooterCopyUI:', error);
  }
}

function setupCopyUIObserver(copyTexts) {
  // Wait for DOM to be fully ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setupCopyUIObserver(copyTexts));
    return;
  }
  
  if (!document.body) {
    setTimeout(() => setupCopyUIObserver(copyTexts), 100);
    return;
  }
  
  try {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node && node.nodeType === Node.ELEMENT_NODE) {
              try {
                copyTexts.forEach(text => {
                  if (node.textContent && node.textContent.includes(text) && 
                      !node.closest('.hex-copy-buttons') && 
                      !node.closest('.hex-context-menu') &&
                      !node.closest('.help-content')) {
                    console.log('Auto-removing dynamically added copy UI:', node);
                    node.remove();
                  }
                });
              } catch (e) {
                // Ignore errors from removed nodes
              }
            }
          });
        }
      });
    });
    
    observer.observe(document.body, { 
      childList: true, 
      subtree: true 
    });
  } catch (error) {
    console.warn('Failed to set up MutationObserver:', error);
  }
}

/* ------------ File Information Handlers ------------ */
function setupFileInfoHandlers() {
  // Hash copy buttons
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-copy-hash')) {
      const hashType = e.target.dataset.hash;
      const hashElement = qs(`#fileInfo${hashType.toUpperCase()}`);
      const hashValue = hashElement.textContent.trim();
      
      if (hashValue && !hashValue.includes('計算中') && !hashValue.includes('エラー')) {
        navigator.clipboard.writeText(hashValue).then(() => {
          showHashCopyToast(hashType.toUpperCase());
        }).catch(err => {
          console.error('Hash copy failed:', err);
          alert('コピーに失敗しました');
        });
      }
    }
  });
}

function showHashCopyToast(hashType) {
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
    animation: slideInRight 0.3s ease;
  `;
  toast.textContent = `${hashType}ハッシュをコピーしました`;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

/* ------------ Mobile Touch Handlers ------------ */
function initMobileTouchHandlers() {
  // Mobile-only initialization
  if (!isMobileDevice()) return;
  
  // Hide mobile hint after first interaction
  const hideHintOnInteraction = () => {
    const hint = qs('#mobileTabHint');
    if (hint) {
      hint.style.display = 'none';
      localStorage.setItem('msi_mobile_hint_seen', 'true');
    }
    // Remove listeners after first use
    document.removeEventListener('touchstart', hideHintOnInteraction);
    document.removeEventListener('click', hideHintOnInteraction);
  };
  
  // Only show hint if not seen before
  if (!localStorage.getItem('msi_mobile_hint_seen')) {
    setTimeout(() => {
      document.addEventListener('touchstart', hideHintOnInteraction, { once: true });
      document.addEventListener('click', hideHintOnInteraction, { once: true });
    }, 3000);
  } else {
    const hint = qs('#mobileTabHint');
    if (hint) hint.style.display = 'none';
  }
  
  // Prevent iOS double-tap zoom on buttons
  document.addEventListener('touchend', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
      e.preventDefault();
    }
  });
  
  // Swipe navigation for tabs
  const tabPanels = qs('.tab-panels');
  let startX = 0;
  let startY = 0;
  let isScrolling = undefined;
  
  tabPanels.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    isScrolling = undefined;
  }, { passive: true });
  
  tabPanels.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) return; // Multi-touch
    
    const touch = e.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    
    if (isScrolling === undefined) {
      isScrolling = Math.abs(deltaY) > Math.abs(deltaX);
    }
    
    // If horizontal swipe, prevent default scrolling
    if (!isScrolling && Math.abs(deltaX) > 50) {
      e.preventDefault();
    }
  }, { passive: false });
  
  tabPanels.addEventListener('touchend', (e) => {
    if (isScrolling || Math.abs(e.changedTouches[0].clientX - startX) < 80) {
      return;
    }
    
    const deltaX = e.changedTouches[0].clientX - startX;
    const currentTab = qs('.main-tab.active');
    const allTabs = qsa('.main-tab');
    const currentIndex = allTabs.indexOf(currentTab);
    
    if (deltaX > 0 && currentIndex > 0) {
      // Swipe right - previous tab
      allTabs[currentIndex - 1].click();
    } else if (deltaX < 0 && currentIndex < allTabs.length - 1) {
      // Swipe left - next tab
      allTabs[currentIndex + 1].click();
    }
  }, { passive: true });
  
  // Long press for context actions
  let longPressTimer = null;
  
  document.addEventListener('touchstart', (e) => {
    if (e.target.closest('.hits-table tr[data-index]')) {
      const row = e.target.closest('tr');
      longPressTimer = setTimeout(() => {
        // Long press detected - show hit details
        showHitContextMenu(row);
        navigator.vibrate?.(50); // Haptic feedback
      }, 600);
    }
  });
  
  document.addEventListener('touchend', () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });
  
  document.addEventListener('touchmove', () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });
}

function showHitContextMenu(row) {
  const index = Number(row.dataset.index);
  const hit = STATE.hits[index];
  if (!hit) return;
  
  // Create temporary context menu
  const menu = document.createElement('div');
  menu.className = 'mobile-context-menu';
  menu.innerHTML = `
    <div class="context-menu-backdrop"></div>
    <div class="context-menu-content">
      <h3>${escapeHtml(hit.name)}</h3>
      <p>オフセット: ${hit.offset ? `0x${hit.offset.toString(16).toUpperCase()}` : 'undefined'}</p>
      <p>長さ: ${hit.length || '-'} バイト</p>
      <p>信頼度: ${hit.confidence || '-'}%</p>
      <div class="context-menu-actions">
        <button class="btn primary" onclick="STATE.hex.scrollToOffset(${hit.offset}); this.closest('.mobile-context-menu').remove();">ジャンプ</button>
        <button class="btn" onclick="this.closest('.mobile-context-menu').remove();">閉じる</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(menu);
  
  // Remove on backdrop click
  menu.querySelector('.context-menu-backdrop').addEventListener('click', () => {
    menu.remove();
  });
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (menu.parentElement) menu.remove();
  }, 5000);
}

function onToggleTheme(e){
  const checked = e.target.checked;
  const mode = checked ? "dark" : "light";
  STATE.theme = mode;
  applyTheme(mode);
  localStorage.setItem("msi_theme", mode);
}
function applyTheme(mode){
  const preferDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = mode==="dark" || (mode==="auto" && preferDark);
  document.documentElement.classList.toggle("dark", isDark);
}

/* ------------ Tabs ------------ */
function onTab(e){
  qsa(".main-tab").forEach(b=>{
    b.classList.remove("active");
    b.setAttribute("aria-selected", "false");
  });
  qsa(".tab-panel").forEach(p=>p.classList.remove("active"));
  e.currentTarget.classList.add("active");
  e.currentTarget.setAttribute("aria-selected", "true");
  const name = e.currentTarget.dataset.tab;
  qs(`#tab-${name}`).classList.add("active");
  
  // Auto-switch to inspect tab when file is loaded
  if (name === "inspect" && STATE.file) {
    // Already handled
  }
}

/* ------------ Load default signatures ------------ */
async function loadDefaultDict(){
  // Try to load from localStorage first
  const saved = localStorage.getItem("msi_dict");
  if (saved && qs("#setAutosave")?.checked !== false) {
    try {
      STATE.dict = JSON.parse(saved);
      console.log("Loaded dictionary from localStorage");
      return;
    } catch (err) {
      console.warn("Failed to load from localStorage, loading default:", err);
    }
  }
  
  // Load default dictionary if no saved data or autosave is disabled
  try {
    const res = await fetch("sigs/default.json");
    const dict = await res.json();
    STATE.dict = dict;
    console.log("Loaded default dictionary");
    
    // Check if enhanced dictionaries are available and offer to load them
    await loadEnhancedDictionaries();
    
  } catch (err) {
    console.error("Failed to load default dictionary:", err);
    // Create minimal fallback dictionary
    STATE.dict = {
      version: "1.0",
      entries: [
        {
          id: "sig-jpeg-basic",
          name: "JPEG",
          extensions: ["jpg", "jpeg"],
          category: "image",
          pattern: "FF D8",
          offset: { type: "absolute", value: 0 },
          confidence: 85,
          notes: "Basic JPEG signature",
          enabled: true
        }
      ]
    };
  }
}

async function loadEnhancedDictionaries() {
  const enhancedFiles = [
    { file: "sigs/enhanced.json", name: "Enhanced Signatures" },
    { file: "sigs/trailers.json", name: "Trailer Signatures" },
    { file: "sigs/forensics.json", name: "Forensic Signatures" }
  ];
  
  let totalAdded = 0;
  
  for (const {file, name} of enhancedFiles) {
    try {
      const res = await fetch(file);
      if (res.ok) {
        const enhancedDict = await res.json();
        if (enhancedDict.entries && Array.isArray(enhancedDict.entries)) {
          // Add unique entries that don't already exist
          const existingIds = new Set(STATE.dict.entries.map(e => e.id));
          const newEntries = enhancedDict.entries.filter(e => !existingIds.has(e.id));
          
          STATE.dict.entries.push(...newEntries);
          totalAdded += newEntries.length;
          console.log(`Loaded ${newEntries.length} signatures from ${name}`);
        }
      }
    } catch (err) {
      console.warn(`Failed to load ${name}:`, err);
    }
  }
  
  if (totalAdded > 0) {
    console.log(`Total enhanced signatures loaded: ${totalAdded}`);
    // Save the enhanced dictionary to localStorage
    if (qs("#setAutosave")?.checked !== false) {
      localStorage.setItem("msi_dict", JSON.stringify(STATE.dict));
    }
  }
}

/* ------------ Signatures UI ------------ */
function renderSigTable(){
  const tbody = qs("#sigTbody");
  const search = qs("#sigSearch").value.trim().toLowerCase();
  const onlyEnabled = qs("#filterEnabled").checked;
  const cat = qs("#filterCategory").value;

  const rows = STATE.dict.entries
    .filter(e => !onlyEnabled || e.enabled !== false)
    .filter(e => !cat || e.category===cat)
    .filter(e=>{
      if (!search) return true;
      const s = `${e.name} ${(e.extensions||[]).join(",")} ${e.category}`.toLowerCase();
      return s.includes(search);
    })
    .map(e=>{
      const exts = (e.extensions||[]).join(",") || "-";
      const patt = (e.pattern||"").slice(0,50) + (e.pattern && e.pattern.length>50 ? "…" : "");
      const off = e.offset?.type==="absolute" ? `@${e.offset.value||0}` : "relative";
      const conf = e.confidence ?? 80;
      const enabled = e.enabled !== false;
      const selected = (STATE.selectedId === e.id) ? ' class="selected"' : "";
      return `<tr data-id="${e.id}"${selected}>
        <td style="text-align:center"><input type="checkbox" ${enabled?"checked":""} data-act="toggle" /></td>
        <td class="name">${escapeHtml(e.name||"")}</td>
        <td>${exts}</td>
        <td><code>${escapeHtml(patt)}</code></td>
        <td>${off}</td>
        <td><span class="badge">${e.category||"-"}</span></td>
        <td style="text-align:center">${conf}%</td>
        <td>
          <button class="btn btn-sm" data-act="select">編集</button>
        </td>
      </tr>`;
    }).join("");
  tbody.innerHTML = rows || `<tr><td colspan="8" class="muted">シグネチャがありません</td></tr>`;

  // bind
  tbody.querySelectorAll("tr").forEach(tr=>{
    const id = tr.dataset.id;
    tr.addEventListener("click", (ev)=>{
      const act = ev.target?.dataset?.act;
      if (act==="toggle"){
        const entry = STATE.dict.entries.find(x=>x.id===id);
        entry.enabled = ev.target.checked;
        saveLocal();
        ev.stopPropagation();
        return;
      }
      if (act==="select"){
        STATE.selectedId = id;
        syncEditForm();
        renderSigTable();
        ev.stopPropagation();
        return;
      }
      // row click -> select
      STATE.selectedId = id; syncEditForm(); renderSigTable();
    });
  });
}

function onAddSig(){
  const id = crypto.randomUUID();
  const e = {
    id, name:"New Signature", extensions:[], category:"other",
    pattern:"FF ?? FF", offset:{type:"absolute", value:0},
    confidence:80, notes:"", enabled:true
  };
  STATE.dict.entries.push(e);
  STATE.selectedId = id;
  renderSigTable(); syncEditForm(); saveLocal();
}
function onDupSig(){
  const cur = currentSig(); if (!cur) return;
  const e = structuredClone(cur);
  e.id = crypto.randomUUID();
  e.name = `${e.name} (copy)`;
  STATE.dict.entries.push(e);
  STATE.selectedId = e.id;
  renderSigTable(); syncEditForm(); saveLocal();
}
function onDelSig(){
  const cur = currentSig(); if (!cur) return;
  if (!confirm(`削除しますか？\n${cur.name}`)) return;
  STATE.dict.entries = STATE.dict.entries.filter(x=>x.id!==cur.id);
  STATE.selectedId = null;
  renderSigTable(); syncEditForm(); saveLocal();
}
function currentSig(){
  return STATE.dict.entries.find(x=>x.id===STATE.selectedId) || null;
}
function syncEditForm(){
  const e = currentSig();
  const f = {
    name: qs("#f_name"), ext: qs("#f_ext"), cat: qs("#f_cat"),
    offType: qs("#f_off_type"), offValue: qs("#f_off_value"),
    offFrom: qs("#f_off_from"), offDelta: qs("#f_off_delta"),
    patt: qs("#f_pattern"), trailer: qs("#f_trailer"),
    min: qs("#f_min"), max: qs("#f_max"), conf: qs("#f_conf"),
    notes: qs("#f_notes"), en: qs("#f_enabled")
  };
  if (!e){
    Object.values(f).forEach(el=>{
      if (el.type==="checkbox") el.checked=false;
      else el.value="";
    });
    return;
  }
  f.name.value = e.name||"";
  f.ext.value = (e.extensions||[]).join(",");
  f.cat.value = e.category||"other";
  f.offType.value = e.offset?.type || "absolute";
  f.offValue.value = e.offset?.value ?? 0;
  f.offFrom.value = e.offset?.from || "";
  f.offDelta.value = e.offset?.delta ?? "";
  f.patt.value = e.pattern||"";
  f.trailer.value = e.trailer||"";
  f.min.value = e.min_size ?? "";
  f.max.value = e.max_size ?? "";
  f.conf.value = e.confidence ?? 80;
  f.notes.value = e.notes||"";
  f.en.checked = e.enabled !== false;
}
function onSaveSig(ev){
  ev.preventDefault();
  const e = currentSig(); if (!e) return;
  e.name = qs("#f_name").value.trim();
  e.extensions = (qs("#f_ext").value||"").split(",").map(s=>s.trim()).filter(Boolean);
  e.category = qs("#f_cat").value || "other";
  e.offset = {
    type: qs("#f_off_type").value || "absolute",
    value: Number(qs("#f_off_value").value||0) || 0,
    from: qs("#f_off_from").value || "",
    delta: Number(qs("#f_off_delta").value||"") || undefined
  };
  e.pattern = qs("#f_pattern").value.trim();
  e.trailer = qs("#f_trailer").value.trim() || undefined;
  e.min_size = valOrNull(qs("#f_min").value);
  e.max_size = valOrNull(qs("#f_max").value);
  e.confidence = Number(qs("#f_conf").value||80);
  e.notes = qs("#f_notes").value;
  e.enabled = qs("#f_enabled").checked;
  renderSigTable(); saveLocal();
  toast("シグネチャを保存しました");
}
function valOrNull(v){ return v==="" ? undefined : Number(v); }
function onPreviewPattern(){
  const patt = qs("#f_pattern").value.trim();
  if (!patt){ setPreview("パターンが未入力です"); return; }
  // MVP: 簡易検査（トークン妥当性のみ）
  try{
    patt.split(/\s+/).forEach(tok=>{
      if (/^\?\?$/.test(tok)) return;
      if (/^[0-9A-Fa-f]{2}$/.test(tok)) return;
      if (/^\[[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}\]$/.test(tok)) return;
      throw new Error(`不正なトークン: ${tok}`);
    });
    setPreview("OK: トークン妥当性チェックを通過しました（MVP）");
  }catch(err){
    setPreview("エラー: " + err.message);
  }
}
function setPreview(msg){
  qs("#previewResult").textContent = msg;
}

/* ------------ File handling ------------ */
async function onFileInput(e){
  try {
    if (!e.target || !e.target.files || e.target.files.length === 0) {
      console.warn('No file selected');
      return;
    }
    const file = e.target.files[0];
    if (file) {
      await openFile(file);
    }
  } catch (error) {
    console.error('File input error:', error);
    alert(`ファイル選択エラー: ${error.message}`);
  }
}
async function onDrop(e){
  try {
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
      console.warn('No file dropped');
      return;
    }
    const file = e.dataTransfer.files[0];
    if (file) {
      await openFile(file);
    }
  } catch (error) {
    console.error('File drop error:', error);
    alert(`ファイルドロップエラー: ${error.message}`);
  }
}
async function openFile(file){
  if (!file) {
    console.error('No file provided to openFile');
    alert('ファイルが指定されていません');
    return;
  }
  
  // Show loading state with progress
  const dropArea = qs("#dropArea");
  if (dropArea) dropArea.classList.add("loading");
  
  // Show progress bar for file reading
  const progressWrap = qs("#progressWrap");
  if (progressWrap) progressWrap.hidden = false;
  setProgress(0);
  showLoading(`ファイル読み込み中: ${file.name}`);
  
  try {
    STATE.file = file;
    
    // Enhanced file reading with chunking for better performance
    const buffer = await readFileWithChunking(file);
    if (!buffer) {
      throw new Error('ファイルの読み込みに失敗しました (バッファが空です)');
    }
    STATE.buffer = buffer;
    
    // Show and populate file info panel
    showFileInfo(file);
    
    // Use requestIdleCallback for non-critical background tasks
    scheduleBackgroundTasks(buffer);
    
    // Clear previous state first
    STATE.hits = [];
    renderHits([]);
    setProgress(100, `読み込み完了`);
    
    // Progressive HEX view initialization based on file size
    await initializeHexViewProgressive(file, buffer);
    
    // Small delay to show completion
    await new Promise(resolve => setTimeout(resolve, 100));
    
    toast(`読み込み完了: ${file.name} (${file.size.toLocaleString()} bytes)`);
  } catch(err) {
    console.error('File loading error:', err);
    alert(`ファイル読み込みエラー: ${err.message}`);
  } finally {
    if (dropArea) dropArea.classList.remove("loading");
    hideLoading();
    const progressWrap = qs("#progressWrap");
    if (progressWrap) progressWrap.hidden = true;
  }
}

function readFileWithChunking(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('ファイルが指定されていません'));
      return;
    }
    
    if (file.size === 0) {
      reject(new Error('ファイルサイズが0バイトです'));
      return;
    }
    
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for better memory management
    const isLargeFile = file.size > 50 * 1024 * 1024; // 50MB threshold
    
    if (!isLargeFile) {
      // Use standard FileReader for smaller files
      return readFileStandard(file).then(resolve).catch(reject);
    }
    
    // Chunked reading for large files
    const chunks = [];
    let offset = 0;
    const totalSize = file.size;
    
    const readNextChunk = () => {
      if (offset >= totalSize) {
        // Combine all chunks
        const combined = new Uint8Array(totalSize);
        let position = 0;
        
        for (const chunk of chunks) {
          combined.set(new Uint8Array(chunk), position);
          position += chunk.byteLength;
        }
        
        setProgress(100, `読み込み完了`);
        resolve(combined.buffer);
        return;
      }
      
      const chunk = file.slice(offset, Math.min(offset + CHUNK_SIZE, totalSize));
      const reader = new FileReader();
      
      reader.onload = (e) => {
        chunks.push(e.target.result);
        offset += CHUNK_SIZE;
        
        const progress = Math.min(95, (offset / totalSize) * 100);
        const loaded = (offset / 1024 / 1024).toFixed(1);
        const total = (totalSize / 1024 / 1024).toFixed(1);
        setProgress(progress, `${loaded}MB / ${total}MB`);
        
        // Use requestIdleCallback for better UI responsiveness
        if (window.requestIdleCallback) {
          requestIdleCallback(readNextChunk);
        } else {
          setTimeout(readNextChunk, 0);
        }
      };
      
      reader.onerror = () => reject(new Error('Chunk reading failed'));
      reader.readAsArrayBuffer(chunk);
    };
    
    readNextChunk();
  });
}

function readFileStandard(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let hasProgressEvents = false;
    
    // Enhanced progress simulation
    const simulateProgress = () => {
      let progress = 0;
      const increment = file.size > 10 * 1024 * 1024 ? 3 : 12; // Smoother for large files
      const interval = setInterval(() => {
        if (hasProgressEvents) {
          clearInterval(interval);
          return;
        }
        
        progress += increment + Math.random() * 5;
        if (progress >= 95) {
          progress = 95;
          clearInterval(interval);
        }
        
        const loaded = (file.size * progress / 100 / 1024 / 1024).toFixed(1);
        const total = (file.size / 1024 / 1024).toFixed(1);
        setProgress(progress, `${loaded}MB / ${total}MB`);
      }, 30);
      
      return interval;
    };
    
    const progressInterval = simulateProgress();
    
    reader.onload = (e) => {
      clearInterval(progressInterval);
      setProgress(100, `読み込み完了`);
      resolve(e.target.result);
    };
    
    reader.onerror = (e) => {
      clearInterval(progressInterval);
      reject(new Error('File reading failed'));
    };
    
    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        hasProgressEvents = true;
        clearInterval(progressInterval);
        
        const progress = (e.loaded / e.total) * 100;
        const loaded = (e.loaded / 1024 / 1024).toFixed(1);
        const total = (e.total / 1024 / 1024).toFixed(1);
        setProgress(progress, `${loaded}MB / ${total}MB`);
      }
    };
    
    reader.readAsArrayBuffer(file);
  });
}

/* ------------ Scan ------------ */
function startScan(){
  if (!STATE.buffer){ alert("先にファイルを読み込みます"); return; }
  if (STATE.worker){ alert("スキャン中です"); return; }
  const scope = qs("#scanRange").value;
  const entries = STATE.dict.entries.filter(e => e.enabled !== false && e.pattern && e.offset);
  if (!entries.length){ alert("有効なシグネチャがありません"); return; }
  
  // Auto-adjust scan scope for large files
  const fileSize = STATE.buffer.byteLength;
  if (fileSize > 100 * 1024 * 1024 && scope === "full") {
    if (!confirm(`ファイルサイズが ${(fileSize/1024/1024).toFixed(1)}MB です。全文スキャンは時間がかかる可能性があります。続行しますか？`)) {
      return;
    }
  }

  // Show loading state
  qs("#startScanBtn").classList.add("loading");
  
  // Slice per scope (MVP: simple)
  let buffer = STATE.buffer;
  if (scope === "head64") buffer = STATE.buffer.slice(0, Math.min(64*1024*1024, STATE.buffer.byteLength));
  if (scope === "head128") buffer = STATE.buffer.slice(0, Math.min(128*1024*1024, STATE.buffer.byteLength));
  if (scope === "headTail") {
    const h = STATE.buffer.slice(0, Math.min(64*1024*1024, STATE.buffer.byteLength));
    const t = STATE.buffer.slice(Math.max(0, STATE.buffer.byteLength - 64*1024*1024));
    // Combine for simplicity in MVP
    const combined = new Uint8Array(h.byteLength + t.byteLength);
    combined.set(new Uint8Array(h), 0);
    combined.set(new Uint8Array(t), h.byteLength);
    buffer = combined.buffer;
  }

  // Start worker
  STATE.worker = new Worker("js/worker.js");
  STATE.worker.onmessage = onScanMessage;
  STATE.worker.postMessage({cmd:"scan", buffer, signatures:entries, options:{}});
  
  qs("#startScanBtn").disabled = true;
  qs("#cancelScanBtn").disabled = false;
  qs("#progressWrap").hidden = false;
  setProgress(0, `スキャン開始 (${entries.length}個のシグネチャ)`);
}

function cancelScan(){
  if (STATE.worker){
    STATE.worker.terminate();
    STATE.worker = null;
  }
  qs("#startScanBtn").classList.remove("loading");
  qs("#startScanBtn").disabled = false;
  qs("#cancelScanBtn").disabled = true;
  qs("#progressWrap").hidden = true;
}

function onScanMessage(e){
  const {type, progress, hits, error} = e.data;
  if (type === "progress"){
    const totalSigs = STATE.dict.entries.filter(e => e.enabled !== false && e.pattern && e.offset).length;
    setProgress(progress, `スキャン中 (${totalSigs}個のシグネチャ)`);
  }
  if (type === "done"){
    STATE.hits = hits || [];
    console.log('Received hits from worker:', STATE.hits);
    renderHits(STATE.hits);
    
    // Update file info with scan results
    updateFileInfoWithScanResults(STATE.hits);
    
    // Show completion animation
    setProgress(100, `完了: ${STATE.hits.length}件のヒット`);
    
    setTimeout(() => {
      cancelScan();
      toast(`スキャン完了: ${STATE.hits.length} 件のヒット`);
      
      // Flash hit count if there are hits
      if (STATE.hits.length > 0) {
        const tbody = qs("#hitsTbody");
        tbody.parentElement.style.animation = "pulse 0.5s";
        setTimeout(() => tbody.parentElement.style.animation = "", 500);
      }
    }, 300);
  }
  if (type === "error"){
    alert(`スキャンエラー: ${error}`);
    cancelScan();
  }
}

function setProgress(p, text){
  const pct = Math.min(100, Math.max(0, p));
  console.log(`Progress update: ${pct.toFixed(1)}% - ${text || 'no text'}`);
  qs("#progressBar").style.width = `${pct}%`;
  const progressText = qs("#progressText");
  if (text) {
    progressText.textContent = `${text} (${Math.round(pct)}%)`;
  } else {
    progressText.textContent = `${Math.round(pct)}%`;
  }
}

// Generate descriptive note for hit based on signature name
function generateHitNote(signatureName, offset, confidence) {
  if (!signatureName) return "";
  
  const name = signatureName.toLowerCase();
  const offsetText = offset === 0 ? "ファイル先頭" : `オフセット0x${offset.toString(16)}`;
  
  // File format specific notes
  if (name.includes('jpeg') || name.includes('jpg')) {
    if (name.includes('soi')) return "JPEG画像の開始マーカー";
    if (name.includes('eoi')) return "JPEG画像の終了マーカー"; 
    if (name.includes('exif')) return "JPEG Exifメタデータ";
    return "JPEG画像関連のデータ";
  }
  
  if (name.includes('png')) {
    if (name.includes('ihdr')) return "PNG画像ヘッダー";
    if (name.includes('iend')) return "PNG画像終了";
    return "PNG画像データ";
  }
  
  if (name.includes('gif')) {
    if (name.includes('87a') || name.includes('89a')) return "GIF画像ヘッダー";
    return "GIF画像データ";
  }
  
  if (name.includes('pdf')) return "PDFドキュメント";
  if (name.includes('zip')) return "ZIP圧縮アーカイブ";
  if (name.includes('rar')) return "RAR圧縮アーカイブ";
  if (name.includes('7z')) return "7-Zip圧縮アーカイブ";
  
  if (name.includes('mp3')) return "MP3音声ファイル";
  if (name.includes('mp4')) return "MP4動画/音声ファイル";
  if (name.includes('avi')) return "AVI動画ファイル";
  
  if (name.includes('exe') || name.includes('pe')) return "Windows実行ファイル";
  if (name.includes('elf')) return "Linux実行ファイル";
  if (name.includes('mach-o')) return "macOS実行ファイル";
  
  if (name.includes('office') || name.includes('docx') || name.includes('xlsx')) return "Microsoft Officeドキュメント";
  if (name.includes('rtf')) return "リッチテキスト文書";
  if (name.includes('xml')) return "XML文書データ";
  if (name.includes('html')) return "HTML文書";
  
  if (name.includes('bmp')) return "Bitmap画像";
  if (name.includes('tiff')) return "TIFF画像";
  if (name.includes('ico')) return "Windowsアイコン";
  
  if (name.includes('tar')) return "TAR形式アーカイブ";
  if (name.includes('gzip')) return "GZIP圧縮データ";
  
  // Confidence based general notes
  if (confidence >= 90) return `高信頼度の${offsetText}でのパターン検出`;
  if (confidence >= 70) return `${offsetText}でのパターン一致`;
  if (confidence >= 50) return `可能性あり：${offsetText}`;
  
  return `${offsetText}でのシグネチャ検出`;
}

function renderHits(hits){
  const tbody = qs("#hitsTbody");
  if (!hits.length){
    tbody.innerHTML = `<tr><td colspan="5" class="muted">ヒットなし</td></tr>`;
    STATE.hex.setHighlights([]);
    STATE.selectedHitIndex = null;
    return;
  }
  
  // Initialize selection state if no hits were previously loaded
  if (STATE.selectedHitIndex === null) {
    STATE.selectedHitIndex = -1; // -1 means show all hits
  }
  
  const rows = hits.map((h,i)=>{
    console.log(`Rendering hit ${i}:`, {name: h.name, offset: h.offset, length: h.length, confidence: h.confidence});
    let offsetDisplay = 'undefined';
    if (typeof h.offset === 'number' && !isNaN(h.offset) && h.offset >= 0) {
      offsetDisplay = `0x${h.offset.toString(16).padStart(8, '0').toUpperCase()}`;
    } else if (h.offset !== undefined) {
      offsetDisplay = `invalid(${h.offset})`;
    }
    
    const isSelected = STATE.selectedHitIndex === i;
    const selectedClass = isSelected ? ' class="selected"' : '';
    
    const noteText = h.notes || generateHitNote(h.name, h.offset, h.confidence);
    
    return `<tr data-index="${i}"${selectedClass}>
      <td>${escapeHtml(h.name||"")}</td>
      <td>${offsetDisplay}</td>
      <td>${h.length||"-"}</td>
      <td>${h.confidence||"-"}</td>
      <td class="hit-note">${escapeHtml(noteText)}</td>
    </tr>`;
  }).join("");
  tbody.innerHTML = rows;
  
  // Update highlights based on selection
  updateHitHighlights();
  
  // Click to select hit
  tbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", ()=>{
      const idx = Number(tr.dataset.index);
      const hit = STATE.hits[idx];
      
      // Toggle selection
      if (STATE.selectedHitIndex === idx) {
        // Clicking on already selected hit deselects it (show all)
        STATE.selectedHitIndex = -1;
      } else {
        // Select this hit
        STATE.selectedHitIndex = idx;
      }
      
      // Re-render to update selection styling
      renderHits(STATE.hits);
      
      // Jump to hit location if valid
      if (hit && typeof hit.offset === 'number' && !isNaN(hit.offset) && hit.offset >= 0) {
        STATE.hex.scrollToOffset(hit.offset);
      }
    });
  });
}

function updateHitHighlights() {
  const validHits = STATE.hits.filter(h => typeof h.offset === 'number' && !isNaN(h.offset) && h.offset >= 0);
  
  if (STATE.selectedHitIndex === -1) {
    // Show all hits
    const ranges = validHits.map(h => ({start: h.offset, end: h.offset + (h.length||10)}));
    STATE.hex.setHighlights(ranges);
  } else if (STATE.selectedHitIndex >= 0 && STATE.selectedHitIndex < STATE.hits.length) {
    // Show only selected hit
    const selectedHit = STATE.hits[STATE.selectedHitIndex];
    if (selectedHit && typeof selectedHit.offset === 'number' && !isNaN(selectedHit.offset) && selectedHit.offset >= 0) {
      const ranges = [{start: selectedHit.offset, end: selectedHit.offset + (selectedHit.length||10)}];
      STATE.hex.setHighlights(ranges);
    } else {
      STATE.hex.setHighlights([]);
    }
  } else {
    // No valid selection
    STATE.hex.setHighlights([]);
  }
}

function jumpHit(dir){
  if (!STATE.hits.length) return;
  
  const validHits = STATE.hits.filter((h, i) => 
    typeof h.offset === 'number' && !isNaN(h.offset) && h.offset >= 0
  );
  
  if (!validHits.length) return;
  
  let targetIndex;
  if (STATE.selectedHitIndex >= 0) {
    // Navigate from current selection
    const currentIndex = STATE.selectedHitIndex;
    if (dir > 0) {
      targetIndex = (currentIndex + 1) % STATE.hits.length;
    } else {
      targetIndex = (currentIndex - 1 + STATE.hits.length) % STATE.hits.length;
    }
  } else {
    // Jump to first/last
    targetIndex = dir > 0 ? 0 : STATE.hits.length - 1;
  }
  
  // Select the target hit
  STATE.selectedHitIndex = targetIndex;
  renderHits(STATE.hits);
  
  // Jump to location
  const targetHit = STATE.hits[targetIndex];
  if (targetHit && typeof targetHit.offset === 'number' && !isNaN(targetHit.offset) && targetHit.offset >= 0) {
    STATE.hex.scrollToOffset(targetHit.offset);
  }
}

function onJump(){
  const val = qs("#jumpOffset").value.trim();
  if (!val) return;
  let offset = 0;
  if (val.startsWith("0x")) offset = parseInt(val, 16);
  else offset = parseInt(val, 10);
  if (!isNaN(offset)) STATE.hex.scrollToOffset(offset);
}

/* ------------ Import/Export ------------ */
function getExportEntries(){
  const scope = qs("#exportScope").value;
  return scope === "enabled" 
    ? STATE.dict.entries.filter(e => e.enabled !== false)
    : STATE.dict.entries;
}

function exportJson(entries){
  const data = {version: "1.0", entries};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "signatures.json";
  a.click();
  URL.revokeObjectURL(url);
}

function exportForemost(entries){
  // Simplified foremost.conf format
  let conf = "# Foremost configuration file (generated)\n\n";
  entries.forEach(e => {
    if (!e.pattern || !e.extensions?.length) return;
    const ext = e.extensions[0];
    const header = e.pattern.replace(/\s+/g, "").toLowerCase();
    const footer = e.trailer ? e.trailer.replace(/\s+/g, "").toLowerCase() : "";
    const size = e.max_size || 20000000;
    conf += `${ext}\ty\t${size}\t\\x${header}`;
    if (footer) conf += `\t\\x${footer}`;
    conf += "\n";
  });
  const blob = new Blob([conf], {type: "text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "foremost.conf";
  a.click();
  URL.revokeObjectURL(url);
}

async function onImport(){
  const file = qs("#importFile").files?.[0];
  if (!file) return;
  
  showLoading(`辞書をインポート中: ${file.name}`);
  
  try {
    const text = await file.text();
    await new Promise(resolve => setTimeout(resolve, 200)); // Show animation
    
    const data = JSON.parse(text);
    if (data.entries && Array.isArray(data.entries)){
      const policy = qs("#mergePolicy").value;
      mergeEntries(data.entries, policy);
      renderSigTable();
      saveLocal();
      toast(`インポート完了: ${data.entries.length} 件`);
    }
  } catch(err) {
    alert(`インポートエラー: ${err.message}`);
  } finally {
    hideLoading();
  }
}

function mergeEntries(newEntries, policy){
  if (policy === "keep-both"){
    // Add all with new IDs
    newEntries.forEach(e => {
      e.id = crypto.randomUUID();
      STATE.dict.entries.push(e);
    });
  } else if (policy === "replace"){
    // Replace by name match
    newEntries.forEach(ne => {
      const idx = STATE.dict.entries.findIndex(e => e.name === ne.name);
      if (idx >= 0){
        ne.id = STATE.dict.entries[idx].id;
        STATE.dict.entries[idx] = ne;
      } else {
        ne.id = crypto.randomUUID();
        STATE.dict.entries.push(ne);
      }
    });
  } else {
    // merge - combine properties
    newEntries.forEach(ne => {
      const existing = STATE.dict.entries.find(e => e.name === ne.name);
      if (existing){
        existing.extensions = [...new Set([...(existing.extensions||[]), ...(ne.extensions||[])])];
        existing.notes = existing.notes ? `${existing.notes}\n${ne.notes||""}` : ne.notes;
        existing.pattern = ne.pattern || existing.pattern;
        existing.trailer = ne.trailer || existing.trailer;
      } else {
        ne.id = crypto.randomUUID();
        STATE.dict.entries.push(ne);
      }
    });
  }
}

/* ------------ Utils ------------ */
function saveLocal(){
  if (qs("#setAutosave")?.checked !== false){
    localStorage.setItem("msi_dict", JSON.stringify(STATE.dict));
  }
}

function toast(msg){
  // Simple console log for MVP
  console.log(`[Toast] ${msg}`);
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ------------ Loading UI ------------ */
function showLoading(text = "処理中..."){
  const overlay = qs("#loadingOverlay");
  const loadingText = qs("#loadingText");
  loadingText.textContent = text;
  overlay.classList.add("active");
}

function hideLoading(){
  const overlay = qs("#loadingOverlay");
  overlay.classList.remove("active");
}

function hideFileInfo() {
  const panel = qs('#fileInfoPanel');
  panel.style.display = 'none';
  panel.classList.remove('show');
}

/* ------------ Performance Optimizations ------------ */
function scheduleBackgroundTasks(buffer) {
  // Use requestIdleCallback to schedule non-critical tasks during idle time
  const scheduleTask = (task, fallbackDelay = 100) => {
    if (window.requestIdleCallback) {
      requestIdleCallback(task, { timeout: 5000 });
    } else {
      setTimeout(task, fallbackDelay);
    }
  };
  
  // Schedule hash calculations with staggered delays
  scheduleTask(() => calculateFileHashes(buffer), 200);
  scheduleTask(() => calculateFileEntropy(buffer), 400);
}

async function initializeHexViewProgressive(file, buffer) {
  const fileSize = file.size;
  
  if (fileSize <= 1024 * 1024) { // <= 1MB: immediate
    STATE.hex.setBuffer(buffer);
  } else if (fileSize <= 10 * 1024 * 1024) { // <= 10MB: small delay
    await new Promise(resolve => setTimeout(resolve, 50));
    STATE.hex.setBuffer(buffer);
  } else if (fileSize <= 100 * 1024 * 1024) { // <= 100MB: longer delay
    await new Promise(resolve => setTimeout(resolve, 200));
    showPartialHexView(buffer, Math.min(5 * 1024 * 1024, buffer.byteLength)); // Show first 5MB
    
    // Load full buffer after user interaction or delay
    setTimeout(() => {
      if (STATE.file === file) { // Ensure file hasn't changed
        STATE.hex.setBuffer(buffer);
        console.log('Full HEX view loaded for large file');
      }
    }, 1000);
  } else { // > 100MB: very conservative approach
    showPartialHexView(buffer, 1024 * 1024); // Show first 1MB only
    console.log('Large file detected - showing partial HEX view only');
  }
}

function showPartialHexView(buffer, maxBytes) {
  const partialBuffer = buffer.slice(0, maxBytes);
  STATE.hex.setBuffer(partialBuffer);
  
  // Show info to user about partial loading
  if (maxBytes < buffer.byteLength) {
    const infoElement = document.createElement('div');
    infoElement.className = 'hex-partial-info';
    infoElement.innerHTML = `
      <div style="background: var(--warning-bg); color: var(--warning-fg); padding: 8px; border-radius: 4px; margin-bottom: 8px; font-size: 12px;">
        📝 大容量ファイルのため、先頭 ${(maxBytes/1024/1024).toFixed(1)}MB のみ表示中
        <button onclick="this.parentElement.parentElement.remove(); STATE.hex.setBuffer(STATE.buffer);" style="margin-left: 8px; font-size: 11px;">全体を表示</button>
      </div>
    `;
    
    const hexView = qs('#hexView');
    hexView.insertBefore(infoElement, hexView.firstChild);
  }
}

/* ------------ Mobile Utilities ------------ */
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         ('ontouchstart' in window) ||
         (window.innerWidth <= 768);
}

function isLandscape() {
  return window.innerWidth > window.innerHeight;
}
