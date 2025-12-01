# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MagicSign Inspector is a browser-based forensic assistance tool for visualizing, editing, and verifying file signatures (magic numbers). It runs entirely in the browser without external data transmission.

## Architecture

### Module Structure

```
js/app.js        # Main application (~1,400 lines): UI state, file handling, scanning orchestration
js/hexview.js    # HexView class: virtual scrolling hex viewer with selection/copy support
js/worker.js     # Web Worker: background signature pattern matching
js/fileinfo.js   # File info panel: hash calculation (MD5/SHA1/SHA256), entropy analysis
```

### Data Flow

1. User drops/selects file → `openFile()` reads via FileReader (chunked for >50MB)
2. File buffer stored in `STATE.buffer`, passed to `HexView.setBuffer()`
3. User clicks "Scan" → Worker receives buffer + enabled signatures
4. Worker performs pattern matching, posts progress/results back
5. Results rendered in hits table, highlights applied to HexView

### Key Technical Details

- **ES6 Modules**: `hexview.js` uses `export class`, `app.js` uses `import`
- **Web Workers**: `worker.js` runs signature matching off main thread
- **Virtual Scrolling**: HexView only renders visible rows (~20) for large files
- **CORS**: Requires HTTP server - `fetch()` used for loading `sigs/*.json`
- **localStorage**: Persists signature dictionary under key `msi_dict`

### Signature Format

Signatures in `sigs/*.json` follow this structure:
```json
{
  "id": "sig-jpeg-soi",
  "name": "JPEG (SOI)",
  "pattern": "FF D8 FF E0 ?? ?? 4A 46 49 46",  // Space-separated hex, ?? = wildcard, [00-1F] = range
  "offset": { "type": "absolute", "value": 0 },  // or "relative" with from/delta
  "trailer": "FF D9",  // Optional end-of-file pattern
  "confidence": 95,
  "extensions": ["jpg", "jpeg"],
  "category": "image",
  "enabled": true
}
```

## Development Commands

### Running Locally

The application requires an HTTP server due to CORS restrictions:

```bash
# Python (recommended)
python -m http.server 5500

# Node.js alternatives
npx http-server -p 5500
npx serve -l 5500

# VS Code Live Server extension also works
```

Then access at `http://localhost:5500/`

### Deployment

For GitHub Pages: all assets use relative paths, no build step required.

## Testing Approach

No formal test framework. Manual testing:
1. Load various file types (JPEG, PNG, PDF, ZIP) to verify signature detection
2. Test HexView virtual scrolling with large files (>100MB)
3. Verify copy buttons (HEX/ASCII/RAW) work with selections
4. Check import/export of signature dictionaries

## Code Patterns

- Global state in `STATE` object (`app.js:6-16`)
- DOM queries via `qs()` / `qsa()` helper functions
- Toast notifications via `toast()` function (currently console.log only)
- Loading overlay controlled by `showLoading()` / `hideLoading()`