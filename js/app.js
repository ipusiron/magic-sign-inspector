import { HexView } from "./hexview.js";
import { validateEntries, toForemostBytes, parseForemostConf } from "./dict.js";
import { findAppendedData, formatSize, appendedFileName, identifyStart } from "./appended.js";
import { checkExtension } from "./extcheck.js";
import { summarizeFile, toCsv } from "./batch.js";
import { blockEntropies, entropyOf, entropyBand, findJumps } from "./entropy.js";

// 文言は js/i18n.js が持つ。ここには言語ごとの文字列を置かない
const t = (key, params) => window.I18n.t(key, params);

// dict.js と worker.js は文言を持たず、{ key, params } を返す。表示の直前にここで訳す
const describeIssue = (issue) => (issue && issue.key ? t(issue.key, issue.params || {}) : String(issue));

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
  batch: [], // 一括チェックの結果
  theme: (localStorage.getItem("msi_theme") || "auto")
};

window.addEventListener("DOMContentLoaded", init);

async function init(){
  // 言語。?lang → 保存値 → ブラウザーの設定の順で決める
  window.I18n.init();
  qs("#langToggle").addEventListener("click", () => {
    window.I18n.setLanguage(window.I18n.language === "ja" ? "en" : "ja");
  });
  // 差し替えで消えた文言は、作り直したときに訳し直す
  document.addEventListener("languagechange", () => {
    renderSigTable();
    renderHits(STATE.hits);
    renderAppended();
    renderExtensionCheck();
    renderBatch();
    renderEntropyChart();
  });

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
  setupBatch();
  setupTabKeyboard();

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
      
      // 表示中の文言で判定すると言語を変えたときに壊れる。16進数かどうかで見る
      if (/^[0-9a-f]{32,128}$/i.test(hashValue)) {
        navigator.clipboard.writeText(hashValue).then(() => {
          showHashCopyToast(hashType.toUpperCase());
        }).catch(err => {
          console.error('Hash copy failed:', err);
          alert(t('toast.copyFailed'));
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
  toast.textContent = t('toast.hashCopied', { name: hashType });
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
      <p>${escapeHtml(t('modal.offset', { offset: hit.offset ? `0x${hit.offset.toString(16).toUpperCase()}` : 'undefined' }))}</p>
      <p>${escapeHtml(t('modal.length', { length: hit.length || '-' }))}</p>
      <p>${escapeHtml(t('modal.confidence', { confidence: hit.confidence || '-' }))}</p>
      <div class="context-menu-actions">
        <button class="btn primary" type="button" data-act="jump">${escapeHtml(t('modal.jump'))}</button>
        <button class="btn" type="button" data-act="close">${escapeHtml(t('modal.close'))}</button>
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

/**
 * WAI-ARIAのタブは、左右のキーで移動し、Homeで先頭、Endで末尾へ行く。
 * Tabキーで中身へ入れるよう、選ばれているタブだけがフォーカス順に入る。
 */
function setupTabKeyboard(){
  const tabs = qsa(".main-tab");

  const updateTabIndex = () => {
    tabs.forEach(t => { t.tabIndex = t.classList.contains("active") ? 0 : -1; });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("keydown", (e) => {
      const last = tabs.length - 1;
      let next = null;
      if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
      if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = last;
      if (next === null) return;

      e.preventDefault();
      tabs[next].click();
      updateTabIndex();
      tabs[next].focus();
    });
  });

  updateTabIndex();
  document.addEventListener("msi:tabchanged", updateTabIndex);
}


/* ------------ エントロピーの分布 ------------ */

// 分ける数。多すぎると1区間が細かくなりすぎ、値が跳ねて読めない
const ENTROPY_BLOCKS = 128;
// これより小さいファイルは、分けても意味がない
const ENTROPY_MIN_SIZE = 2048;

/** SVGの要素を作る。属性は文字列で渡す */
function svgEl(tag, attrs = {}, children = []){
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of children) node.appendChild(c);
  return node;
}

/**
 * 全体で1つの値しか出さないと、「前半はテキスト、後半は暗号化」のような
 * 切れ目が平均に埋もれる。分けて描くと、その境目が目で分かる。
 */
function renderEntropyChart(){
  const panel = qs("#entropyPanel");
  if (!panel) return;
  if (!STATE.buffer) { panel.hidden = true; return; }

  const view = new Uint8Array(STATE.buffer);
  const description = qs("#entropyDescription");
  const note = qs("#entropyNote");
  const chart = qs("#entropyChart");

  if (view.length < ENTROPY_MIN_SIZE) {
    panel.hidden = false;
    chart.replaceChildren();
    description.textContent = t("entropy.tooSmall");
    note.textContent = t("entropy.overall", { value: entropyOf(view).toFixed(3) });
    return;
  }

  const blocks = blockEntropies(view, ENTROPY_BLOCKS);
  STATE.entropyBlocks = blocks;

  const width = 1000;
  const height = 180;
  const padLeft = 28;
  const padBottom = 16;
  const plotW = width - padLeft;
  const plotH = height - padBottom;
  const barW = plotW / blocks.length;

  const children = [];
  // 目盛り（0・2・4・6・8 bits/byte）
  for (const level of [0, 2, 4, 6, 8]) {
    const y = plotH - (level / 8) * plotH;
    children.push(svgEl("line", { class: "entropy-grid", x1: padLeft, y1: y, x2: width, y2: y }));
    children.push(svgEl("text", { class: "entropy-axis", x: 0, y: y + 3 }, [document.createTextNode(String(level))]));
  }

  blocks.forEach((block, i) => {
    const h = Math.max(1, (block.value / 8) * plotH);
    const band = entropyBand(block.value);
    const bar = svgEl("rect", {
      class: `entropy-block band-${band}`,
      x: padLeft + i * barW,
      y: plotH - h,
      width: Math.max(1, barW - 0.5),
      height: h
    });
    const label = t("entropy.blockLabel", {
      offset: block.start.toString(16).toUpperCase().padStart(8, "0"),
      size: formatSize(block.end - block.start),
      value: block.value.toFixed(2),
      band: t(`entropy.band.${band}`)
    });
    bar.appendChild(svgEl("title", {}, [document.createTextNode(label)]));
    bar.addEventListener("click", () => STATE.hex.scrollToOffset(block.start));
    children.push(bar);
  });

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-label": t("entropy.heading")
  }, children);

  chart.replaceChildren(svg, buildEntropyLegend());
  description.textContent = t("entropy.description", { blocks: blocks.length });

  const jumps = findJumps(blocks);
  const overall = t("entropy.overall", { value: entropyOf(view).toFixed(3) });
  if (jumps.length) {
    const where = jumps.slice(0, 3).map((j) => t("entropy.jumpAt", {
      offset: j.at.toString(16).toUpperCase().padStart(8, "0"),
      from: j.from.toFixed(1),
      to: j.to.toFixed(1)
    })).join(t("list.separator"));
    note.textContent = `${overall} ${t("entropy.jump", { count: jumps.length })} ${where}`;
  } else {
    note.textContent = overall;
  }
  panel.hidden = false;
}

function buildEntropyLegend(){
  const legend = el("div", { class: "entropy-legend" });
  for (const band of ["flat", "low", "text", "mixed", "high"]) {
    const item = el("span", {}, [
      el("span", { class: `swatch band-${band}` }),
      document.createTextNode(t(`entropy.band.${band}`))
    ]);
    legend.appendChild(item);
  }
  return legend;
}

/* ------------ 一括チェック ------------ */

// 一度に扱う上限。carving の出力は数千件になることがあるが、
// 画面に全部並べても読めないうえ、走査の時間もかかる
const BATCH_LIMIT = 200;
// 1件あたり、この大きさまでを読む。終端を見たいので先頭と末尾を取る
const BATCH_HEAD = 4 * 1024 * 1024;

function setupBatch(){
  const input = qs("#batchInput");
  const drop = qs("#batchDrop");
  if (!input || !drop) return;

  qs("#batchOpenBtn").addEventListener("click", () => input.click());
  input.addEventListener("change", (e) => runBatch([...e.target.files]));
  ;["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ;["dragleave","drop"].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    runBatch([...(e.dataTransfer?.files || [])]);
  });
  qs("#batchExportBtn").addEventListener("click", exportBatchCsv);
  qs("#batchClearBtn").addEventListener("click", () => {
    STATE.batch = [];
    renderBatch();
  });
}

/** 1ファイルを走査する。worker は使い捨てにして、途中で止まっても後を引かせない */
function scanOneFile(segments, fileSize, entries){
  return new Promise((resolve) => {
    const worker = new Worker("js/worker.js");
    const done = (value) => { worker.terminate(); resolve(value); };
    worker.onmessage = (e) => {
      if (e.data.type === "done") done({ hits: e.data.hits || [], trailerChecked: e.data.trailerChecked !== false });
      if (e.data.type === "error") done({ hits: [], trailerChecked: false });
    };
    worker.onerror = () => done({ hits: [], trailerChecked: false });
    worker.postMessage({ cmd: "scan", fileSize, segments, signatures: entries });
  });
}

/** 大きなファイルでも、先頭と末尾だけを読む。終端の照合に末尾が要る */
async function readBatchSegments(file){
  if (file.size <= BATCH_HEAD * 2) {
    return [{ buffer: await file.arrayBuffer(), base: 0 }];
  }
  const head = await file.slice(0, BATCH_HEAD).arrayBuffer();
  const tailStart = file.size - BATCH_HEAD;
  const tail = await file.slice(tailStart).arrayBuffer();
  return [{ buffer: head, base: 0 }, { buffer: tail, base: tailStart }];
}

async function sha256Of(file){
  if (!crypto?.subtle) return "";
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    debugLog("sha256 failed", err);
    return "";
  }
}

/** 後ろに付いた部分の先頭だけを読んで、それが何かを見る */
async function identifyAppendedInBatch(file, hits, trailerChecked){
  const info = findAppendedData(hits, file.size, trailerChecked);
  if (!info) return [];
  const head = await file.slice(info.start, Math.min(info.start + 64, file.size)).arrayBuffer();
  return identifyStart(new Uint8Array(head), STATE.dict.entries).map((g) => g.name);
}

async function runBatch(files){
  if (!files.length) return;
  const entries = STATE.dict.entries.filter((e) => e.enabled !== false && e.pattern && e.offset);
  const targets = files.slice(0, BATCH_LIMIT);
  if (files.length > BATCH_LIMIT) toast(t("batch.limit", { limit: BATCH_LIMIT }));

  STATE.batch = [];
  renderBatch();
  const status = qs("#batchStatus");

  for (let i = 0; i < targets.length; i += 1) {
    const file = targets[i];
    status.textContent = t("batch.running", { done: i, total: targets.length });
    try {
      const segments = await readBatchSegments(file);
      const { hits, trailerChecked } = await scanOneFile(segments, file.size, entries);
      const sha256 = file.size <= 64 * 1024 * 1024 ? await sha256Of(file) : "";
      const appendedNames = await identifyAppendedInBatch(file, hits, trailerChecked);
      STATE.batch.push(summarizeFile({ name: file.name, size: file.size, hits, trailerChecked, sha256, appendedNames }));
    } catch (err) {
      debugLog("batch read failed", err);
      toast(t("batch.readError", { name: file.name }));
    }
    // 1件ごとに出す。全部終わるまで真っ白、を避ける
    renderBatch(targets.length, i + 1);
  }
  renderBatch();
}

function batchTrailerCell(row){
  const map = {
    found: ["batch.trailer.found", "batch-flag-ok"],
    missing: ["batch.trailer.missing", "batch-flag-ng"],
    unchecked: ["batch.trailer.unchecked", "batch-flag-warn"],
    none: ["batch.trailer.none", "muted"]
  };
  const [key, cls] = map[row.trailer] || map.none;
  return el("td", {}, [el("span", { class: cls, text: t(key) })]);
}

function renderBatch(total, done){
  const tbody = qs("#batchTbody");
  const status = qs("#batchStatus");
  if (!tbody) return;

  const rows = STATE.batch || [];
  tbody.replaceChildren(...rows.map((row) => {
    const cells = [
      el("td", { text: row.name }),
      el("td", { class: "num", text: row.sizeText }),
      el("td", {}, [el("span", row.formatText ? { text: row.formatText } : { class: "muted", text: t("batch.format.none") })]),
      batchTrailerCell(row),
      el("td", {}, [row.mismatch
        ? el("span", { class: row.executable ? "batch-flag-ng" : "batch-flag-warn",
                       text: t("batch.mismatch.ng", { extensions: row.mismatch.slice(0, 3).map((e) => "." + e).join(t("list.separator")) }) })
        : el("span", { class: "batch-flag-ok", text: t("batch.mismatch.ok") })]),
      el("td", { class: "num" }, [row.appendedBytes
        ? el("span", { class: row.appendedNames.length ? "batch-flag-warn" : "muted", text: formatSize(row.appendedBytes) })
        : el("span", { class: "muted", text: t("batch.appended.none") })]),
      el("td", { class: "mono", text: row.sha256 })
    ];
    return el("tr", {}, cells);
  }));

  qs("#batchExportBtn").disabled = rows.length === 0;
  qs("#batchClearBtn").disabled = rows.length === 0;
  if (typeof total === "number") status.textContent = t("batch.running", { done, total });
  else status.textContent = rows.length ? t("batch.done", { total: rows.length }) : t("batch.empty");
}

const BATCH_CSV_HEADERS = () => [
  { label: t("batch.th.name"), value: (r) => r.name },
  { label: t("batch.th.size"), value: (r) => r.size },
  { label: t("batch.th.format"), value: (r) => r.formats.join("|") },
  { label: t("batch.th.trailer"), value: (r) => r.trailer },
  { label: t("batch.th.mismatch"), value: (r) => (r.mismatch ? r.mismatch.join("|") : "") },
  { label: t("batch.th.appended"), value: (r) => r.appendedBytes },
  { label: t("batch.th.sha256"), value: (r) => r.sha256 }
];

function exportBatchCsv(){
  const rows = STATE.batch || [];
  if (!rows.length) return;
  // Excel が UTF-8 と分かるように BOM を付ける
  const csv = "\ufeff" + toCsv(rows, BATCH_CSV_HEADERS());
  const name = "magic-sign-inspector-batch.csv";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  toast(t("batch.exported", { total: rows.length, name }));
}

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
  document.dispatchEvent(new CustomEvent("msi:tabchanged"));
  
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
    el("td", {}, [el("button", { class: "btn btn-sm", type: "button", dataset: { act: "select" }, text: t("sig.edit") })])
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
    tbody.append(el("tr", {}, [el("td", { colspan: "8", class: "muted", text: t("sig.empty") })]));
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
  if (!confirm(t("sig.confirmDelete", { name: cur.name }))) return;
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
  toast(t("sig.saved"));
}
function valOrNull(v){ return v==="" ? undefined : Number(v); }
function onPreviewPattern(){
  const patt = qs("#f_pattern").value.trim();
  if (!patt){ setPreview(t("form.patternEmpty")); return; }
  // MVP: 簡易検査（トークン妥当性のみ）
  try{
    patt.split(/\s+/).forEach(tok=>{
      if (/^\?\?$/.test(tok)) return;
      if (/^[0-9A-Fa-f]{2}$/.test(tok)) return;
      if (/^\[[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}\]$/.test(tok)) return;
      throw new Error(t("form.badToken", { token: tok }));
    });
    setPreview(t("form.tokensOk"));
  }catch(err){
    setPreview(t("form.errorPrefix") + err.message);
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
    alert(t("toast.fileError", { message: error.message }));
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
    alert(t("toast.dropError", { message: error.message }));
  }
}
async function openFile(file){
  if (!file) {
    console.error('No file provided to openFile');
    alert(t("toast.noFile"));
    return;
  }
  
  // Show loading state with progress
  const dropArea = qs("#dropArea");
  if (dropArea) dropArea.classList.add("loading");
  
  // Show progress bar for file reading
  const progressWrap = qs("#progressWrap");
  if (progressWrap) progressWrap.hidden = false;
  setProgress(0);
  showLoading(t("toast.reading", { name: file.name }));
  
  try {
    STATE.file = file;
    
    // Enhanced file reading with chunking for better performance
    const buffer = await readFileWithChunking(file);
    if (!buffer) {
      throw new Error(t("toast.emptyBuffer"));
    }
    STATE.buffer = buffer;
    
    // Show and populate file info panel
    showFileInfo(file);
    
    // Use requestIdleCallback for non-critical background tasks
    scheduleBackgroundTasks(buffer);
    
    // Clear previous state first
    STATE.hits = [];
    renderHits([]);
    renderAppended();
    renderExtensionCheck();
    renderEntropyChart();
    setProgress(100, t("toast.readDone"));
    
    // Progressive HEX view initialization based on file size
    await initializeHexViewProgressive(file, buffer);
    
    // Small delay to show completion
    await new Promise(resolve => setTimeout(resolve, 100));
    
    toast(t("toast.readDoneDetail", { name: file.name, bytes: file.size.toLocaleString() }));
  } catch(err) {
    console.error('File loading error:', err);
    alert(t("toast.readError", { message: err.message }));
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
      reject(new Error(t("toast.noFile")));
      return;
    }
    
    if (file.size === 0) {
      reject(new Error(t("toast.zeroSize")));
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
        
        setProgress(100, t("toast.readDone"));
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
      if (!hasProgressEvents) setProgress(null, t("toast.loading"));
    }, 200);

    const progressInterval = simulateProgress();
    
    reader.onload = (e) => {
      clearInterval(progressInterval);
      setProgress(100, t("toast.readDone"));
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
  if (!STATE.buffer){ alert(t("toast.needFile")); return; }
  if (STATE.worker){ alert(t("toast.scanning")); return; }
  const scope = qs("#scanRange").value;
  const entries = STATE.dict.entries.filter(e => e.enabled !== false && e.pattern && e.offset);
  if (!entries.length){ alert(t("toast.noEnabled")); return; }
  
  // Auto-adjust scan scope for large files
  const fileSize = STATE.buffer.byteLength;
  if (fileSize > 100 * 1024 * 1024 && scope === "full") {
    if (!confirm(t("toast.confirmFull", { mb: (fileSize/1024/1024).toFixed(1) }))) {
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
  setProgress(0, t("toast.scanStart", { count: entries.length }));
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
    setProgress(progress, t("toast.scanProgress", { count: totalSigs }));
  }
  if (type === "done"){
    STATE.hits = hits || [];
    STATE.scanSkipped = e.data.skipped || null;
    STATE.trailerChecked = e.data.trailerChecked !== false;
    debugLog('Received hits from worker:', STATE.hits);
    renderHits(STATE.hits);
    
    // Update file info with scan results
    updateFileInfoWithScanResults(STATE.hits);
    renderAppended();
    renderExtensionCheck();
    
    // Show completion animation
    setProgress(100, t("toast.scanDone", { count: STATE.hits.length }));
    
    setTimeout(() => {
      cancelScan();
      toast(t("toast.scanDoneDetail", { count: STATE.hits.length }));
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
    alert(t("toast.scanError", { message: error }));
    cancelScan();
  }
}

function setProgress(p, text){
  const bar = qs("#progressBar");
  const progressText = qs("#progressText");

  // p が null のときは割合が分からない。数字を作らず、動いていることだけを見せる
  if (p === null || typeof p === "undefined") {
    bar.classList.add("indeterminate");
    progressText.textContent = text || t("toast.processing");
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
  const offsetText = offset === 0 ? t("note.headStart") : t("note.atOffset", { hex: offset.toString(16) });
  
  // File format specific notes
  if (name.includes('jpeg') || name.includes('jpg')) {
    if (name.includes('soi')) return t("fmt.jpegSoi");
    if (name.includes('eoi')) return t("fmt.jpegEoi");
    if (name.includes('exif')) return t("fmt.jpegExif");
    return t("fmt.jpegOther");
  }
  
  if (name.includes('png')) {
    if (name.includes('ihdr')) return t("fmt.pngHeader");
    if (name.includes('iend')) return t("fmt.pngEnd");
    return t("fmt.pngData");
  }
  
  if (name.includes('gif')) {
    if (name.includes('87a') || name.includes('89a')) return t("fmt.gifHeader");
    return t("fmt.gifData");
  }
  
  if (name.includes('pdf')) return t("fmt.pdf");
  if (name.includes('zip')) return t("fmt.zip");
  if (name.includes('rar')) return t("fmt.rar");
  if (name.includes('7z')) return t("fmt.sevenZip");
  
  if (name.includes('mp3')) return t("fmt.mp3");
  if (name.includes('mp4')) return t("fmt.mp4");
  if (name.includes('avi')) return t("fmt.avi");
  
  if (name.includes('exe') || name.includes('pe')) return t("fmt.exe");
  if (name.includes('elf')) return t("fmt.elf");
  if (name.includes('mach-o')) return t("fmt.macho");
  
  if (name.includes('office') || name.includes('docx') || name.includes('xlsx')) return t("fmt.office");
  if (name.includes('rtf')) return t("fmt.rtf");
  if (name.includes('xml')) return t("fmt.xml");
  if (name.includes('html')) return t("fmt.html");
  
  if (name.includes('bmp')) return t("fmt.bmp");
  if (name.includes('tiff')) return t("fmt.tiff");
  if (name.includes('ico')) return t("fmt.ico");
  
  if (name.includes('tar')) return t("fmt.tar");
  if (name.includes('gzip')) return t("fmt.gzip");
  
  // Confidence based general notes
  if (confidence >= 90) return t("note.highConfidence", { where: offsetText });
  if (confidence >= 70) return t("note.match", { where: offsetText });
  if (confidence >= 50) return t("note.maybe", { where: offsetText });
  
  return t("note.detected", { where: offsetText });
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
    messages.push(t("toast.skipTrailer", { count: skipped.trailerUnverifiable }));
  }
  if (skipped.outOfSize > 0) {
    messages.push(t("toast.skipSize", { count: skipped.outOfSize }));
  }
  const invalid = skipped.invalidPattern || [];
  if (invalid.length > 0) {
    messages.push(t("toast.skipInvalid", { count: invalid.length, name: invalid[0].name }));
  }
  for (const message of messages) toast(message);
}

/**
 * ファイルの終端より後ろに何か付いていれば、それを伝える。
 * 画像の後ろに書庫を繋ぐ隠し方は、開いても見た目に出ない。
 */
function renderAppended(){
  const panel = qs("#appendedPanel");
  if (!panel) return;
  const info = findAppendedData(STATE.hits, STATE.buffer ? STATE.buffer.byteLength : 0, STATE.trailerChecked);
  STATE.appended = info;

  if (!info) { panel.hidden = true; panel.replaceChildren(); return; }

  // 走査で見つかったものに加えて、後ろの部分を1つのファイルとみなして先頭も照合する。
  // 既定の辞書はほとんどが「ファイル先頭から0バイト目」の指定なので、
  // これをやらないと、繋がれた側が何なのかを言えない
  const head = new Uint8Array(STATE.buffer, info.start, Math.min(info.length, 64));
  const guessed = identifyStart(head, STATE.dict.entries).map((g) => g.name);
  const names = [...new Set([...guessed, ...info.inside.map((h) => h.name)].filter(Boolean))].slice(0, 5);
  // 何も見つからないうちから⚠️を出すと、形式の終端構造の一部まで
  // 「隠されている」ように読めてしまう（ZIPの終端記録で実際に起きた）
  const suspicious = names.length > 0;
  panel.classList.toggle("quiet", !suspicious);
  const children = [
    el("strong", { class: "appended-heading",
                   text: t(suspicious ? "appended.heading" : "appended.headingQuiet") }),
    el("p", { text: t("appended.body", {
      name: info.base.name || "-",
      end: info.start.toString(16).toUpperCase().padStart(8, "0"),
      size: formatSize(info.length)
    }) }),
    el("p", { class: "muted small", text: suspicious ? t("appended.inside", { names: names.join(t("list.separator")) }) : t("appended.nothing") }),
    el("p", { class: "muted small", text: suspicious ? t("appended.hint") : t("appended.structural") })
  ];

  const jump = el("button", { class: "btn btn-sm", type: "button", text: t("appended.jump") });
  jump.addEventListener("click", () => STATE.hex.scrollToOffset(info.start));
  const save = el("button", { class: "btn btn-sm primary", type: "button", text: t("appended.save") });
  save.addEventListener("click", () => saveAppended(info));
  children.push(el("div", { class: "appended-actions" }, [jump, save]));

  panel.replaceChildren(...children);
  panel.hidden = false;
}

/** 後ろに付いた部分だけを切り出して保存する */
function saveAppended(info){
  if (!STATE.buffer) return;
  const part = STATE.buffer.slice(info.start, info.start + info.length);
  const name = appendedFileName(STATE.file ? STATE.file.name : "file", info.start);
  const url = URL.createObjectURL(new Blob([part], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  toast(t("appended.saved", { size: formatSize(info.length), name }));
}

/**
 * 拡張子を変えただけのファイルは、見た目では見分けられない。
 * 先頭のバイト列と名前がくい違っていたら、それを言う。
 */
/** 長い一覧は、先頭だけ出して残りは件数で言う */
function shortList(items, keep = 3){
  const sep = t("list.separator");
  if (items.length <= keep) return items.join(sep);
  return t("list.more", { items: items.slice(0, keep).join(sep), count: items.length - keep });
}

function renderExtensionCheck(){
  const panel = qs("#extPanel");
  if (!panel) return;
  const info = checkExtension(STATE.file ? STATE.file.name : "", STATE.hits);
  STATE.extMismatch = info;

  if (!info) { panel.hidden = true; panel.replaceChildren(); return; }

  const sep = t("list.separator");
  const children = [
    el("strong", { class: "appended-heading", text: t("ext.heading") }),
    el("p", { text: t("ext.body", { ext: info.ext, names: shortList(info.names) }) }),
    el("p", { class: "muted small", text: t("ext.expected", { extensions: shortList(info.extensions.map((e) => "." + e)) }) })
  ];
  if (info.executable) {
    children.push(el("p", { class: "ext-danger", text: t("ext.executable") }));
  }
  children.push(el("p", { class: "muted small", text: t("ext.note") }));

  panel.replaceChildren(...children);
  panel.hidden = false;
}

function renderHits(hits){
  const tbody = qs("#hitsTbody");
  if (!hits.length){
    tbody.replaceChildren(el("tr", {}, [el("td", { colspan: "6", class: "muted", text: t("hits.none") })]));
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
      found: t("hits.trailerFound"),
      missing: t("hits.trailerMissing"),
      unchecked: t("hits.trailerUnchecked"),
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
  const lines = [
    t("foremost.header1"),
    t("foremost.header2"),
    ""
  ];
  const skipped = [];

  entries.forEach(e => {
    if (!e.pattern || !e.extensions?.length) return;

    const header = toForemostBytes(e.pattern);
    if (header.error) {
      // 範囲指定は foremost に対応する書き方がない。黙って壊れた行を出さない
      skipped.push(t("foremost.headerError", { name: e.name || e.extensions[0], error: describeIssue(header.error) }));
      return;
    }

    let line = `${e.extensions[0]}\ty\t${e.max_size || 20000000}\t${header.value}`;

    if (e.trailer) {
      const footer = toForemostBytes(e.trailer);
      if (footer.error) {
        skipped.push(t("foremost.trailerError", { name: e.name || e.extensions[0], error: describeIssue(footer.error) }));
        return;
      }
      line += `\t${footer.value}`;
    }

    lines.push(line);
  });

  const blob = new Blob([lines.join("\n") + "\n"], {type: "text/plain"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "foremost.conf";
  a.click();
  URL.revokeObjectURL(url);

  if (skipped.length > 0) {
    toast(t("toast.foremostSkipped", { count: skipped.length, sample: skipped[0] }));
  }
}

async function onImport(){
  const file = qs("#importFile").files?.[0];
  if (!file) return;
  
  showLoading(t("toast.importing", { name: file.name }));
  
  try {
    const text = await file.text();
    const firstBody = text.trim().split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith("#")) || "";
    const isConf = /\.conf$/i.test(file.name) || !firstBody.startsWith("{");
    await new Promise(resolve => setTimeout(resolve, 200)); // Show animation
    
    // foremost.conf も読めるようにした。
    // UIとREADMEは以前から .conf 対応を謳っていたが、実装は JSON.parse だけで、
    // .conf を選ぶと必ず「インポートエラー」になっていた。
    if (isConf) {
      const { accepted, errors } = parseForemostConf(text);
      if (accepted.length > 0) {
        mergeEntries(validateEntries(accepted).accepted, qs("#mergePolicy").value);
        renderSigTable();
        saveLocal();
      }
      toast(t("toast.importDone", { count: accepted.length }));
      if (errors.length > 0) toast(t("toast.importLineErrors", { count: errors.length, sample: describeIssue(errors[0]) }));
      return;
    }

    const data = JSON.parse(text);
    if (data.entries && Array.isArray(data.entries)){
      const policy = qs("#mergePolicy").value;
      const { accepted, errors } = validateEntries(data.entries);

      if (accepted.length > 0) {
        mergeEntries(accepted, policy);
        renderSigTable();
        saveLocal();
      }
      toast(t("toast.importDone", { count: accepted.length }));

      // 落ちたものは黙って捨てず、件数と理由の例を伝える
      if (errors.length > 0) {
        toast(t("toast.importItemErrors", { count: errors.length, sample: describeIssue(errors[0]) }));
      }
    } else {
      throw new Error(t("toast.noEntries"));
    }
  } catch(err) {
    alert(t("toast.importError", { message: err.message }));
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
function showLoading(text){
  text = text || t("loading.text");
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
      document.createTextNode(t("hex.partialBanner", { mb: (maxBytes/1024/1024).toFixed(1) })),
      el("button", { class: "btn btn-sm", type: "button", text: t("hex.showAll") })
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
