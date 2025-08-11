// File Information Functions for MagicSign Inspector
// Handles file metadata, hash calculation, and entropy analysis

/* ------------ File Information Functions ------------ */
function showFileInfo(file) {
  const panel = document.querySelector('#fileInfoPanel');
  panel.style.display = 'block';
  panel.classList.add('show');
  
  // Basic file information
  document.querySelector('#fileInfoName').textContent = file.name;
  document.querySelector('#fileInfoSize').innerHTML = formatFileSize(file.size);
  document.querySelector('#fileInfoModified').textContent = file.lastModified ? new Date(file.lastModified).toLocaleString('ja-JP') : '不明';
  document.querySelector('#fileInfoType').textContent = file.type || 'application/octet-stream';
  
  // Reset hash status
  document.querySelector('#hashStatus').textContent = '計算中...';
  document.querySelector('#hashStatus').className = 'hash-status';
  
  // Reset analysis fields
  document.querySelector('#fileInfoPatterns').textContent = 'スキャン待ち';
  document.querySelector('#fileInfoFormat').textContent = '解析中...';
  
  // Hide Exif checker row initially
  const exifRow = document.querySelector('#exifCheckRow');
  if (exifRow) {
    exifRow.style.display = 'none';
  }
}

function formatFileSize(bytes) {
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2);
  
  return `<strong>${size} ${sizes[i]}</strong><span class="size-bytes">(${bytes.toLocaleString()} bytes)</span>`;
}

async function calculateFileHashes(buffer) {
  try {
    // Start MD5 calculation separately (using custom implementation)
    const md5Promise = calculateMD5(buffer);
    
    // Calculate SHA hashes in parallel using Web Crypto API
    const [sha1, sha256] = await Promise.all([
      calculateHashDirect(buffer, 'SHA-1'), 
      calculateHashDirect(buffer, 'SHA-256')
    ]);
    
    // Update SHA hashes immediately
    updateHashUI('SHA1', sha1);
    updateHashUI('SHA256', sha256);
    
    // Wait for MD5 and update
    try {
      const md5 = await md5Promise;
      updateHashUI('MD5', md5);
    } catch (md5Error) {
      console.warn('MD5 calculation failed:', md5Error);
      updateHashUI('MD5', 'MD5計算はこのブラウザーではサポートされていません');
    }
    
    document.querySelector('#hashStatus').textContent = '完了';
    document.querySelector('#hashStatus').className = 'hash-status completed';
    
  } catch (error) {
    console.error('Hash calculation failed:', error);
    document.querySelector('#hashStatus').textContent = 'エラー';
    document.querySelector('#hashStatus').className = 'hash-status error';
    
    // Show error in hash fields
    updateHashUI('MD5', 'エラー: 計算に失敗しました');
    updateHashUI('SHA1', 'エラー: 計算に失敗しました');
    updateHashUI('SHA256', 'エラー: 計算に失敗しました');
  }
}

async function calculateHashDirect(buffer, algorithm) {
  const hashBuffer = await crypto.subtle.digest(algorithm, buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// MD5 implementation (since Web Crypto API doesn't support MD5)
async function calculateMD5(buffer) {
  return new Promise((resolve) => {
    // Simple MD5 implementation for browser
    const view = new Uint8Array(buffer);
    const md5Hash = md5Internal(view);
    resolve(md5Hash);
  });
}

function md5Internal(data) {
  // MD5 constants
  const K = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ]);
  
  const r = [
    7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
    5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
    4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
    6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21
  ];
  
  // Initialize MD5 hash values
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  
  // Pre-processing: adding padding bits
  const originalLength = data.length;
  const bitLength = originalLength * 8;
  
  // Create padded message
  const paddedLength = Math.ceil((originalLength + 9) / 64) * 64;
  const paddedData = new Uint8Array(paddedLength);
  paddedData.set(data);
  paddedData[originalLength] = 0x80; // padding bit
  
  // Add length in bits as 64-bit little-endian
  const lengthView = new DataView(paddedData.buffer);
  lengthView.setUint32(paddedLength - 8, bitLength, true);
  lengthView.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);
  
  // Process the message in 512-bit chunks
  for (let offset = 0; offset < paddedLength; offset += 64) {
    const chunk = new Uint32Array(paddedData.buffer, offset, 16);
    
    // Convert to little-endian if needed
    const X = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      X[i] = chunk[i];
    }
    
    let A = h0, B = h1, C = h2, D = h3;
    
    // Main loop
    for (let i = 0; i < 64; i++) {
      let F, g;
      
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      
      F = (F + A + K[i] + X[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << r[i]) | (F >>> (32 - r[i])))) >>> 0;
    }
    
    h0 = (h0 + A) >>> 0;
    h1 = (h1 + B) >>> 0;
    h2 = (h2 + C) >>> 0;
    h3 = (h3 + D) >>> 0;
  }
  
  // Produce the final hash value as a 128-bit number (little-endian)
  const result = new ArrayBuffer(16);
  const view = new DataView(result);
  view.setUint32(0, h0, true);
  view.setUint32(4, h1, true);
  view.setUint32(8, h2, true);
  view.setUint32(12, h3, true);
  
  // Convert to hex string
  const bytes = new Uint8Array(result);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function updateHashUI(hashType, hashValue) {
  const element = document.querySelector(`#fileInfo${hashType}`);
  element.innerHTML = `<span style="word-break: break-all;">${hashValue}</span>`;
}

async function calculateFileEntropy(buffer) {
  try {
    const view = new Uint8Array(buffer);
    const entropy = calculateEntropy(view);
    
    // Update entropy display with visual bar
    const entropyElement = document.querySelector('#fileInfoEntropy');
    const entropyPercent = (entropy / 8) * 100; // Normalize to 0-100%
    
    entropyElement.innerHTML = `
      <div class="entropy-bar">
        <span class="entropy-value">${entropy.toFixed(3)}</span>
        <div class="entropy-visual">
          <div class="entropy-fill" style="width: ${entropyPercent}%"></div>
        </div>
        <span style="font-size: 11px; color: var(--muted);">${entropyPercent.toFixed(1)}%</span>
      </div>
    `;
    
  } catch (error) {
    console.error('Entropy calculation failed:', error);
    document.querySelector('#fileInfoEntropy').innerHTML = '<span class="entropy-loading">エラー: 計算に失敗しました</span>';
  }
}

function calculateEntropy(buffer) {
  const freqs = new Array(256).fill(0);
  
  // Count byte frequencies
  for (let i = 0; i < buffer.length; i++) {
    freqs[buffer[i]]++;
  }
  
  // Calculate Shannon entropy
  let entropy = 0;
  for (let freq of freqs) {
    if (freq > 0) {
      const p = freq / buffer.length;
      entropy -= p * Math.log2(p);
    }
  }
  
  return entropy;
}

function updateFileInfoWithScanResults(hits) {
  // Update pattern detection count
  document.querySelector('#fileInfoPatterns').textContent = `${hits.length} 個のパターンを検出`;
  
  // Analyze detected formats and show badges
  const detectedFormats = analyzeDetectedFormats(hits);
  const formatElement = document.querySelector('#fileInfoFormat');
  
  if (detectedFormats.length === 0) {
    formatElement.innerHTML = '<span class="format-badge low-confidence">不明</span>';
  } else {
    const badges = detectedFormats.map(format => {
      const confidenceClass = format.confidence >= 90 ? 'high-confidence' : 
                             format.confidence >= 70 ? 'medium-confidence' : 'low-confidence';
      return `<span class="format-badge ${confidenceClass}" title="信頼度: ${format.confidence}%">${format.name}</span>`;
    });
    formatElement.innerHTML = badges.join('');
  }
  
  // Show Exif checker link for JPEG/PNG files
  showExifCheckerIfApplicable(detectedFormats);
}

function analyzeDetectedFormats(hits) {
  const formatMap = new Map();
  
  // Group hits by detected format/category
  for (const hit of hits) {
    if (!hit.name) continue;
    
    // Extract format from signature name (simple heuristic)
    const format = extractFormatFromSignatureName(hit.name);
    if (!format) continue;
    
    if (formatMap.has(format)) {
      const existing = formatMap.get(format);
      existing.confidence = Math.max(existing.confidence, hit.confidence || 80);
      existing.count++;
    } else {
      formatMap.set(format, {
        name: format,
        confidence: hit.confidence || 80,
        count: 1
      });
    }
  }
  
  // Sort by confidence and count
  return Array.from(formatMap.values())
    .sort((a, b) => b.confidence - a.confidence || b.count - a.count)
    .slice(0, 3); // Show top 3 formats
}

function extractFormatFromSignatureName(name) {
  const lowerName = name.toLowerCase();
  
  // Simple format extraction rules
  if (lowerName.includes('jpeg') || lowerName.includes('jpg')) return 'JPEG';
  if (lowerName.includes('png')) return 'PNG';
  if (lowerName.includes('gif')) return 'GIF';
  if (lowerName.includes('pdf')) return 'PDF';
  if (lowerName.includes('zip')) return 'ZIP';
  if (lowerName.includes('rar')) return 'RAR';
  if (lowerName.includes('7z')) return '7-Zip';
  if (lowerName.includes('mp3')) return 'MP3';
  if (lowerName.includes('mp4')) return 'MP4';
  if (lowerName.includes('avi')) return 'AVI';
  if (lowerName.includes('exe')) return 'PE/EXE';
  if (lowerName.includes('elf')) return 'ELF';
  if (lowerName.includes('bmp')) return 'BMP';
  if (lowerName.includes('tiff')) return 'TIFF';
  
  // Extract format from parentheses like "JPEG (SOI)"
  const match = name.match(/^([A-Z0-9]+)/i);
  return match ? match[1].toUpperCase() : null;
}

function showExifCheckerIfApplicable(detectedFormats) {
  const exifRow = document.querySelector('#exifCheckRow');
  
  // Check if any detected format is JPEG or PNG
  const hasImageFormat = detectedFormats.some(format => 
    format.name === 'JPEG' || format.name === 'PNG'
  );
  
  if (hasImageFormat) {
    exifRow.style.display = 'flex';
    
    // Add animation for smooth appearance
    exifRow.style.opacity = '0';
    exifRow.style.transform = 'translateY(-10px)';
    
    // Animate in
    setTimeout(() => {
      exifRow.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      exifRow.style.opacity = '1';
      exifRow.style.transform = 'translateY(0)';
    }, 100);
  } else {
    exifRow.style.display = 'none';
  }
}

function hideFileInfo() {
  const panel = document.querySelector('#fileInfoPanel');
  panel.style.display = 'none';
  panel.classList.remove('show');
  
  // Hide Exif checker row when file info is hidden
  const exifRow = document.querySelector('#exifCheckRow');
  if (exifRow) {
    exifRow.style.display = 'none';
  }
}

// Export functions to global scope for use in app.js
window.showFileInfo = showFileInfo;
window.calculateFileHashes = calculateFileHashes;
window.calculateFileEntropy = calculateFileEntropy;
window.updateFileInfoWithScanResults = updateFileInfoWithScanResults;
window.hideFileInfo = hideFileInfo;