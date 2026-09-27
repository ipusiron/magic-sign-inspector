import { HexView } from "./hexview.js";
import { validateEntries } from "./dict.js";

const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

const DEBUG = false;
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

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

  // このファイルはモジュールなので、外のスクリプトからは STATE が見えない。
  // 必要なものだけを名前を付けて公開する（以前は window.STATE を参照しており、
  // 常に undefined でショートカットが動いていなかった）。
  window.MSI = { get hex() { return STATE.hex; } };

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
  
}

/* ------------ Footer Copy UI Cleanup ------------ */
// cleanupFooterCopyUI / setupCopyUIObserver は削除した。
// 「コピー」を含むノードを見つけ次第消す仕掛けだったため、
// 自作のコピー完了トーストを表示直後に消していた。
// 元になったコンテキストメニューはすでに無効化されている。

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
  
  // ダブルタップの拡大抑止は CSS の touch-action で行う。
  // document への touchend で preventDefault すると、合成されるクリックまで止まり、
  // タッチ端末でボタンが反応しなくなる。
  
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
        <button class="btn primary" type="button" data-act="jump">ジャンプ</button>
        <button class="btn" type="button" data-act="close">閉じる</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(menu);
  
  // Remove on backdrop click
  menu.querySelector('.context-menu-backdrop').addEventListener('click', () => {
    menu.remove();
  });

  // インラインの onclick をやめ、ここで結ぶ。
  // app.js はモジュールなので STATE は window から見えず、
  // インラインの onclick からは参照できずに ReferenceError になっていた。
  menu.addEventListener("click", (ev) => {
    const act = ev.target?.dataset?.act;
    if (act === "jump" && typeof hit.offset === "number") STATE.hex.scrollToOffset(hit.offset);
    if (act === "jump" || act === "close") menu.remove();
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
      debugLog("Loaded dictionary from localStorage");
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
    debugLog("Loaded default dictionary");
    
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
          debugLog(`Loaded ${newEntries.length} signatures from ${name}`);
        }
      }
    } catch (err) {
      console.warn(`Failed to load ${name}:`, err);
    }
  }
  
  if (totalAdded > 0) {
    debugLog(`Total enhanced signatures loaded: ${totalAdded}`);
    // Save the enhanced dictionary to localStorage
    if (qs("#setAutosave")?.checked !== false) {
      localStorage.setItem("msi_dict", JSON.stringify(STATE.dict));
    }
  }
}

/* ------------ Signatures UI ------------ */
/**
 * 要素を組み立てる小さなヘルパー。
 * HTML文字列を作らないので、辞書の中身に何が入っていても表示が壊れない。
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name === "dataset") Object.assign(node.dataset, value);
    else if (value !== null && typeof value !== "undefined") node.setAttribute(name, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

/**
 * シグネチャ1件の行を組み立てる。
 * 以前は拡張子・カテゴリ・idをそのままHTMLへ差し込んでいた。
 * 辞書はインポートできて localStorage へ残るので、
 * 壊れた値を入れた辞書を読ませるだけで表示を乗っ取れる状態だった。
 * とくに id は data-id="${e.id}" と属性に入れており、
 * 引用符ひとつで属性から抜け出せた。
 */
function buildSigRow(e) {
  const exts = (e.extensions || []).join(",") || "-";
  const patt = (e.pattern || "").slice(0, 50) + (e.pattern && e.pattern.length > 50 ? "…" : "");
  const off = e.offset?.type === "absolute" ? `@${e.offset.value || 0}` : "relative";
  const conf = e.confidence ?? 80;
  const enabled = e.enabled !== false;

  const checkbox = el("input", { type: "checkbox", dataset: { act: "toggle" } });
  checkbox.checked = enabled;

  const tr = el("tr", { dataset: { id: String(e.id ?? "") } }, [
    el("td", { class: "cell-center" }, [checkbox]),
    el("td", { class: "name", text: e.name || "" }),
    el("td", { text: exts }),
    el("td", {}, [el("code", { text: patt })]),
    el("td", { text: off }),
    el("td", {}, [el("span", { class: "badge", text: e.category || "-" })]),
    el("td", { class: "cell-center", text: `${conf}%` }),
    el("td", {}, [el("button", { class: "btn btn-sm", type: "button", dataset: { act: "select" }, text: "編集" })])
  ]);

  if (STATE.selectedId === e.id) tr.className = "selected";
  return tr;
}

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
    .map(buildSigRow);

  tbody.replaceChildren();
  if (rows.length === 0) {
    tbody.append(el("tr", {}, [el("td", { colspan: "8", class: "muted", text: "シグネチャがありません" })]));
  } else {
    tbody.append(...rows);
  }

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
    
    // 実際の読み込み量が取れないときは、割合を作らずに「読み込み中」とだけ出す。
    // 以前は乱数で進むバーを見せており、実際の進み具合と関係がなかった。
    const simulateProgress = () => setInterval(() => {
      if (!hasProgressEvents) setProgress(null, "読み込み中");
    }, 200);

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
  
  // 走査する区間を決める。区間ごとに実座標（base）を持たせるので、
  // 末尾側のヒットもファイルの実座標のまま報告できる。
  // 以前は先頭と末尾を1本に連結していたため、末尾側の位置がずれていた。
  const HEAD_64 = 64 * 1024 * 1024;
  const HEAD_128 = 128 * 1024 * 1024;
  const total = STATE.buffer.byteLength;

  let segments;
  if (scope === "head64") {
    segments = [{ buffer: STATE.buffer.slice(0, Math.min(HEAD_64, total)), base: 0 }];
  } else if (scope === "head128") {
    segments = [{ buffer: STATE.buffer.slice(0, Math.min(HEAD_128, total)), base: 0 }];
  } else if (scope === "headTail") {
    const headLen = Math.min(HEAD_64, total);
    const tailStart = Math.max(headLen, total - HEAD_64);
    segments = [{ buffer: STATE.buffer.slice(0, headLen), base: 0 }];
    if (tailStart < total) {
      segments.push({ buffer: STATE.buffer.slice(tailStart), base: tailStart });
    }
  } else {
    segments = [{ buffer: STATE.buffer, base: 0 }];
  }

  // Start worker
  STATE.worker = new Worker("js/worker.js");
  STATE.worker.onmessage = onScanMessage;
  STATE.worker.postMessage({ cmd: "scan", fileSize: total, segments, signatures: entries });

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
    STATE.scanSkipped = e.data.skipped || null;
    STATE.trailerChecked = e.data.trailerChecked !== false;
    debugLog('Received hits from worker:', STATE.hits);
    renderHits(STATE.hits);
    
    // Update file info with scan results
    updateFileInfoWithScanResults(STATE.hits);
    
    // Show completion animation
    setProgress(100, `完了: ${STATE.hits.length}件のヒット`);
    
    setTimeout(() => {
      cancelScan();
      toast(`スキャン完了: ${STATE.hits.length} 件のヒット`);
      reportSkipped(STATE.scanSkipped, STATE.trailerChecked);
      
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
  const bar = qs("#progressBar");
  const progressText = qs("#progressText");

  // p が null のときは割合が分からない。数字を作らず、動いていることだけを見せる
  if (p === null || typeof p === "undefined") {
    bar.classList.add("indeterminate");
    progressText.textContent = text || "処理中";
    return;
  }

  bar.classList.remove("indeterminate");
  const pct = Math.min(100, Math.max(0, p));
  bar.style.width = `${pct}%`;
  progressText.textContent = text ? `${text} (${Math.round(pct)}%)` : `${Math.round(pct)}%`;
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

/**
 * 走査で落としたものを黙って捨てず、件数と理由を伝える。
 * 末尾を見られない範囲の走査では、トレーラーを要求するシグネチャを
 * ヒットさせないので、その旨も伝える。
 */
function reportSkipped(skipped, trailerChecked){
  if (!skipped) return;
  const messages = [];
  if (!trailerChecked && skipped.trailerUnverifiable > 0) {
    messages.push(`末尾を見ない範囲の走査のため、終端の並びを確かめるシグネチャ${skipped.trailerUnverifiable}件は判定していません`);
  }
  if (skipped.outOfSize > 0) {
    messages.push(`大きさの条件に合わないシグネチャ${skipped.outOfSize}件を除きました`);
  }
  const invalid = skipped.invalidPattern || [];
  if (invalid.length > 0) {
    messages.push(`パターンを読めないシグネチャ${invalid.length}件を飛ばしました（例: ${invalid[0].name}）`);
  }
  for (const message of messages) toast(message);
}

function renderHits(hits){
  const tbody = qs("#hitsTbody");
  if (!hits.length){
    tbody.innerHTML = `<tr><td colspan="6" class="muted">ヒットなし</td></tr>`;
    STATE.hex.setHighlights([]);
    STATE.selectedHitIndex = null;
    return;
  }
  
  // Initialize selection state if no hits were previously loaded
  if (STATE.selectedHitIndex === null) {
    STATE.selectedHitIndex = -1; // -1 means show all hits
  }
  
  const rows = hits.map((h,i)=>{
    debugLog(`Rendering hit ${i}:`, {name: h.name, offset: h.offset, length: h.length, confidence: h.confidence});
    let offsetDisplay = 'undefined';
    if (typeof h.offset === 'number' && !isNaN(h.offset) && h.offset >= 0) {
      offsetDisplay = `0x${h.offset.toString(16).padStart(8, '0').toUpperCase()}`;
    } else if (h.offset !== undefined) {
      offsetDisplay = `invalid(${h.offset})`;
    }
    
    const isSelected = STATE.selectedHitIndex === i;
    const selectedClass = isSelected ? ' class="selected"' : '';
    
    const noteText = h.notes || generateHitNote(h.name, h.offset, h.confidence);

    // 終端の並びを照合した結果。
    // 「あるはずの終端が見つからない」ことこそ、壊れたファイルの手がかりになる
    const trailerLabels = {
      found: "✅ あり",
      missing: "⚠️ 見つからない",
      unchecked: "－ 未照合",
      none: "－"
    };
    const trailerLabel = trailerLabels[h.trailerState] || "－";
    const trailerClass = h.trailerState === "missing" ? "trailer-missing" : "";
    
    return `<tr data-index="${i}"${selectedClass}>
      <td>${escapeHtml(h.name||"")}</td>
      <td>${offsetDisplay}</td>
      <td>${h.length||"-"}</td>
      <td>${h.confidence||"-"}</td>
      <td class="hit-trailer ${trailerClass}">${escapeHtml(trailerLabel)}</td>
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
      const { accepted, errors } = validateEntries(data.entries);

      if (accepted.length > 0) {
        mergeEntries(accepted, policy);
        renderSigTable();
        saveLocal();
      }
      toast(`インポート完了: ${accepted.length} 件`);

      // 落ちたものは黙って捨てず、件数と理由の例を伝える
      if (errors.length > 0) {
        toast(`${errors.length}件を取り込めませんでした（例: ${errors[0]}）`);
      }
    } else {
      throw new Error("entries の配列が見つかりません");
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
  debugLog(`[Toast] ${msg}`);
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
        debugLog('Full HEX view loaded for large file');
      }
    }, 1000);
  } else { // > 100MB: very conservative approach
    showPartialHexView(buffer, 1024 * 1024); // Show first 1MB only
    debugLog('Large file detected - showing partial HEX view only');
  }
}

function showPartialHexView(buffer, maxBytes) {
  const partialBuffer = buffer.slice(0, maxBytes);
  STATE.hex.setBuffer(partialBuffer);
  
  // Show info to user about partial loading
  if (maxBytes < buffer.byteLength) {
    const infoElement = document.createElement('div');
    infoElement.className = 'hex-partial-info';
    const banner = el("div", { class: "hex-partial-banner" }, [
      document.createTextNode(`📝 大容量ファイルのため、先頭 ${(maxBytes/1024/1024).toFixed(1)}MB のみ表示中`),
      el("button", { class: "btn btn-sm", type: "button", text: "全体を表示" })
    ]);
    banner.querySelector("button").addEventListener("click", () => {
      infoElement.remove();
      STATE.hex.setBuffer(STATE.buffer);
    });
    infoElement.replaceChildren(banner);
    
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
