# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MagicSign Inspector is a browser-based forensic assistance tool for visualizing, editing, and verifying file signatures (magic numbers). It runs entirely in the browser without external data transmission.

## Architecture

### Core Components

- **Frontend-only application**: Pure HTML/CSS/JavaScript with no backend dependencies
- **Module structure**: Uses ES6 modules (`type="module"`) and Web Workers for background processing
- **File signature dictionary**: JSON-based signature definitions stored in `sigs/default.json`
- **Hex viewer**: Custom implementation in `js/hexview.js` for binary data visualization with highlighting
- **Worker-based scanning**: Background processing via `js/worker.js` for non-blocking file analysis

### Key Technical Details

- **CORS requirements**: Application uses `fetch()` to load JSON dictionaries, requiring HTTP server (not `file://`)
- **No build process**: Static files served directly, no compilation or bundling required
- **localStorage**: Used for persisting user settings and custom signatures

## Development Commands

### Running Locally

The application requires an HTTP server due to CORS restrictions:

```bash
# Python (recommended)
python -m http.server 5500

# Node.js alternatives
npx http-server -p 5500
npx serve -l 5500
```

Then access at `http://localhost:5500/`

### Deployment

For GitHub Pages deployment:
- Ensure `.nojekyll` file exists to prevent Jekyll processing
- All assets are relative paths, no configuration needed

## File Signature Format

Signatures are defined in JSON with the following structure:
- `pattern`: Hex bytes with support for wildcards (`??`) and ranges (`[00-1F]`)
- `offset`: Absolute or relative positioning
- `trailer`: Optional end-of-file pattern
- `confidence`: 0-100 reliability score

## Testing Approach

No formal test framework is configured. Manual testing approach:
1. Load various file types to verify signature detection
2. Test import/export functionality with different dictionary formats
3. Verify hex viewer highlighting and navigation
4. Check browser compatibility (Chrome, Firefox, Safari, Edge)

## Important Notes

- The main application logic (`js/app.js`) appears to be empty/placeholder
- Worker implementation (`js/worker.js`) handles the actual file scanning logic
- No external dependencies or package manager configuration
- Designed for forensic education and CTF challenges, not production forensic work