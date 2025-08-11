// Web Worker: scan buffer against simple signature patterns
// Supported pattern tokens: "FF", "??", "[00-1F]" (range). Space-separated.
// Signatures item shape (subset):
// { id, name, pattern, offset: {type:"absolute"| "relative", value?}, confidence }

self.addEventListener("message", async (e)=>{
  const { cmd } = e.data || {};
  if (cmd === "scan"){
    try{
      const { buffer, signatures, options } = e.data;
      const view = new Uint8Array(buffer);
      const hits = [];

      const active = signatures.filter(s => s.enabled !== false && s.pattern && s.offset);
      const compiled = active.map(compileSig);
      const len = view.length;

      // Separate signatures by type for efficient processing
      const absZero = compiled.filter(c => c.offsetType === "absolute" && c.offsetValue === 0);
      const absFixed = compiled.filter(c => c.offsetType === "absolute" && c.offsetValue > 0);
      const relative = compiled.filter(c => c.offsetType === "relative");
      
      console.log(`Scanning ${len} bytes: ${absZero.length} at offset 0, ${absFixed.length} at fixed offsets, ${relative.length} relative`);

      let progress = 0;
      let completed = 0;
      const totalTasks = absZero.length + absFixed.length + (relative.length > 0 ? 1 : 0);
      
      // 1. Quick check at offset 0 (most common case)
      for (const c of absZero){
        console.log(`Checking signature "${c.name}" at offset 0`);
        matchAt(view, c, 0, hits);
        completed++;
        progress = Math.round(completed / totalTasks * 80); // Reserve 20% for relative scan
        self.postMessage({ type:"progress", progress });
      }

      // 2. Check signatures at specific absolute offsets (very fast)
      for (const c of absFixed){
        if (c.offsetValue < len) {
          console.log(`Checking signature "${c.name}" at fixed offset ${c.offsetValue}`);
          matchAt(view, c, c.offsetValue, hits);
        }
        completed++;
        progress = Math.round(completed / totalTasks * 80);
        self.postMessage({ type:"progress", progress });
      }

      // 3. Optimized sliding window scan for relative signatures (if any)
      if (relative.length > 0) {
        await performOptimizedScan(view, relative, hits, len);
      } else {
        // No relative signatures, we're done
        console.log('Absolute-only scan complete. Final hits array:', hits.map(h => ({name: h.name, offset: h.offset, length: h.length})));
        finalizeScan(hits);
      }
    }catch(err){
      self.postMessage({ type:"error", error: String(err&&err.message || err) });
    }
  }
});

function compileSig(sig){
  const toks = (sig.pattern||"").trim().split(/\s+/);
  const parts = toks.map(tok=>{
    if (/^\?\?$/.test(tok)) return { kind:"any" };
    const mRange = tok.match(/^\[([0-9A-Fa-f]{2})-([0-9A-Fa-f]{2})\]$/);
    if (mRange){
      return { kind:"range", lo:parseInt(mRange[1],16), hi:parseInt(mRange[2],16) };
    }
    if (/^[0-9A-Fa-f]{2}$/.test(tok)){
      return { kind:"byte", val:parseInt(tok,16) };
    }
    throw new Error(`Unsupported token in pattern: ${tok}`);
  });

  const offsetType = sig.offset?.type || "absolute";
  let offsetValue = 0;
  if (sig.offset && typeof sig.offset.value !== 'undefined') {
    const parsedValue = Number(sig.offset.value);
    offsetValue = isNaN(parsedValue) ? 0 : parsedValue;
  }

  const compiled = {
    id: sig.id, name: sig.name, confidence: sig.confidence ?? 80,
    parts, length: parts.length, offsetType, offsetValue
  };
  
  console.log(`Compiled signature: ${sig.name}, offsetType: ${offsetType}, offsetValue: ${offsetValue}`, sig.offset);
  
  return compiled;
}

async function performOptimizedScan(view, relative, hits, len) {
  const CHUNK_SIZE = Math.min(500000, Math.max(100000, Math.floor(len/40))); // Dynamic chunk size
  const BATCH_SIZE = Math.min(10000, CHUNK_SIZE / 10); // Process in smaller batches for responsiveness
  
  let i = 0;
  
  const scanBatch = async () => {
    const startTime = performance.now();
    let processed = 0;
    
    while (i < len && processed < BATCH_SIZE) {
      for (const c of relative) {
        matchAt(view, c, i, hits);
      }
      i++;
      processed++;
      
      // Yield control if we've been processing for too long
      if (performance.now() - startTime > 16) { // ~60fps
        break;
      }
    }
    
    // Update progress (80% to 100% for relative scan)
    const relativeProgress = 80 + Math.round((i / len) * 20);
    self.postMessage({ type:"progress", progress: relativeProgress });
    
    if (i < len) {
      // Continue in next frame
      setTimeout(scanBatch, 0);
    } else {
      // Scanning complete
      console.log('Optimized relative scan complete. Final hits array:', hits.map(h => ({name: h.name, offset: h.offset, length: h.length})));
      finalizeScan(hits);
    }
  };
  
  scanBatch();
}

function finalizeScan(hits) {
  // Ensure all hit objects are plain objects for safe serialization
  const serializedHits = hits.map(h => ({
    id: h.id,
    name: h.name,
    offset: h.offset,
    length: h.length,
    confidence: h.confidence,
    notes: h.notes
  }));
  
  self.postMessage({ type:"progress", progress: 100 });
  self.postMessage({ type:"done", hits: serializedHits });
}

function matchAt(view, c, pos, hits){
  if (typeof pos !== 'number' || isNaN(pos) || pos < 0) {
    console.error(`Invalid pos value: ${pos} (type: ${typeof pos}) for signature ${c.name}`);
    return;
  }
  if (pos + c.length > view.length) return;
  
  // Optimized pattern matching with early exit
  for (let j = 0; j < c.length; j++){
    const b = view[pos + j];
    const p = c.parts[j];
    
    if (p.kind === "byte") {
      if (b !== p.val) return; // Early exit
    } else if (p.kind === "range") {
      if (b < p.lo || b > p.hi) return; // Early exit
    }
    // p.kind === "any" always matches
  }
  
  const hit = {
    id: c.id, 
    name: c.name, 
    offset: pos, 
    length: c.length, 
    confidence: c.confidence || 80, 
    notes: ""
  };
  
  hits.push(hit);
}
