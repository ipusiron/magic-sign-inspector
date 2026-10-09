# MagicSign Inspector - File Signature (Magic Number) Inspector

English · [日本語](README.md)

![GitHub Repo stars](https://img.shields.io/github/stars/ipusiron/magic-sign-inspector?style=social)
![GitHub forks](https://img.shields.io/github/forks/ipusiron/magic-sign-inspector?style=social)
![GitHub last commit](https://img.shields.io/github/last-commit/ipusiron/magic-sign-inspector)
![GitHub license](https://img.shields.io/github/license/ipusiron/magic-sign-inspector)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-blue?logo=github)](https://ipusiron.github.io/magic-sign-inspector/)

**Day040 - 100 Security Tools with Generative AI**

**MagicSign Inspector** shows you the **magic numbers (file signatures)** inside a file, and lets you edit and test the definitions that find them.

It loads a dictionary of signatures, scans any binary you give it, and highlights every place that matches. Dictionaries can be imported and exported as JSON, and it can also read part of a `foremost.conf` and write one out.

Everything runs in your browser. No file you open is uploaded anywhere.

---

## 🔗 Demo

👉 [https://ipusiron.github.io/magic-sign-inspector/](https://ipusiron.github.io/magic-sign-inspector/)

---

## 📸 Screenshot

> ![Inspecting a JPEG whose trailer is present](assets/screenshot-en.png)
>
> *A complete JPEG: every row says the trailer was found*

> ![The same JPEG cut short, with the trailer missing](assets/screenshot-truncated-en.png)
>
> *The same file with its end removed. The trailer is missing, and JPEG (Complete) no longer matches.*

> ![A banner showing a ZIP appended behind a JPEG](assets/screenshot-appended-en.png)
>
> *An archive glued behind an image. That part alone can be saved out.*

> ![Six files checked in one batch](assets/screenshot-batch-en.png)
>
> *Carving output, one row per file. It exports as CSV too.*

---

## 🎯 Who it is for

- **People learning forensics** — see what a magic number actually looks like inside a file
- **CTF players** — write a signature for an unknown format and find its fragments
- **Investigators** — check carving results one file at a time before trusting them
- **Teachers** — show how file identification works, without a command line

---

## 🛠 What it does

Ways of using this tool in particular

- Confirming that a shorter signature hits by chance more easily (false-positive and forensics classes): searching the 13-byte example `00 FF D8 FF E0 00 FF D8 11 00 FF D8 FF`, the 2-byte `FF D8` hits 3 times, at positions 1, 6 and 10, while the 4-byte `FF D8 FF E0` hits once, at position 1. You can confirm by the hit count that a shorter signature hits unrelated data more easily and raises false positives in carving
- Confirming the magic number in hex turned into bytes (encoding and file-format classes): searching `FF D8 FF` in hex gives the bytes `255 216 255`. This is the magic number always at the start of a JPEG file. You can confirm, by the hex-to-byte mapping, how a file format is told apart by the first few bytes rather than by the characters you see
- Confirming that a wildcard maps to foremost's notation (tool-integration classes): a signature with any single byte written as `??`, like `FF D8 FF ?? E0`, is converted to `\xff\xd8\xff?\xe0` for foremost. You can confirm by the conversion that this tool's `??` maps to the `?` in the config file of the carving tool foremost

### Inspecting a file

- **184 signatures included** (181 enabled by default): 29 image, 26 archive, 20 document, 17 audio, 14 video, 78 other
- **Trailer checking** — 26 of them also carry the bytes expected at the end of the file, so you can tell a complete file from one that was cut short
- **Data appended past the end** — finds an archive glued behind an image, and saves just that part
- **Extension mismatch** — says so when a file named `.jpg` starts with the bytes of an executable
- **Batch checking** — compare carving output row by row and export it as CSV
- **Entropy profile** — the file split into parts, so the seam between text and encrypted data is visible
- **Hex search** — by hex or by text, from the right-click menu or Ctrl+F
- **Drag and drop** a file, or pick one with the button
- **Scan range** — first 64MB, first 128MB, start + end, or the whole file
- **Hex view** with virtual scrolling, so a large file still scrolls smoothly
- **Hashes** — MD5, SHA1 and SHA256
- **Entropy** — a rough sign of whether the data is compressed or encrypted

### Working with signatures

- Create and edit signatures in a form; no JSON editing required
- Patterns take fixed bytes (`FF`), any byte (`??`) and ranges (`[00-1F]`)
- Offsets can be absolute, or relative to another signature's match
- `min_size` and `max_size` cut down false matches
- Import and export JSON; import a `foremost.conf` or a subset of `scalpel.conf`; export a `foremost.conf`
- Search and filter by name, extension or category

### Everything else

- **Japanese and English** — switch with the button in the header, with `?lang=en`, or let it follow your browser
- **Dark mode**, following your OS by default
- **Keyboard** — tabs move with the arrow keys; see Settings / Help for the rest
- **Nothing leaves your browser** — the page declares `default-src 'none'` and loads only its own files

---

## 🖥 How it relates to the `file` command

On Unix-like systems, `file` decides a file's type from byte patterns in its **magic file**, not from the extension. MagicSign Inspector works on the same idea, with a few differences.

| | `file` | MagicSign Inspector |
|---|---|---|
| Runs in | a terminal | a browser |
| Output | one line of text | a list of matches, highlighted in a hex view |
| Editing the dictionary | a text editor | a form |
| Multiple matches | shows the best one | shows all of them |
| Carving tools | indirectly | exports `foremost.conf` |

**File carving** recovers files from damaged or fragmented storage by looking for their signatures rather than trusting the filesystem. `foremost`, `scalpel`, `PhotoRec` and `bulk_extractor` all work this way, and all of them suffer when the signatures are imprecise. This tool is a place to check and adjust those signatures before you run them, and to look at what came out afterwards.

---

## 🚀 Running it

### Online

Just open the demo page:

👉 [https://ipusiron.github.io/magic-sign-inspector/](https://ipusiron.github.io/magic-sign-inspector/)

### Locally

The page fetches its dictionaries, uses ES modules and starts a Web Worker, so **opening `index.html` through `file://` will not work**. Serve it over HTTP.

```bash
git clone https://github.com/ipusiron/magic-sign-inspector.git
cd magic-sign-inspector
python -m http.server 5500
```

Then open http://localhost:5500/ .

`npx http-server -p 5500` and the VS Code "Live Server" extension work just as well.

---

## 🧪 Tests

No dependencies; the tests run on Node's own runner.

```bash
npm test
```

93 tests in all.

| File | What it covers |
|------|----------------|
| `test/scan.test.js` | scanning, trailer checking, relative offsets, size limits, skipping unreadable patterns |
| `test/dict.test.js` | validating an imported dictionary |
| `test/foremost.test.js` | reading and writing `foremost.conf` |
| `test/search.test.js` | the hex search: parsing a query, finding every match, wrapping around |
| `test/appended.test.js` | data past the end of the file, and naming the extracted part |
| `test/extcheck.test.js` | extension mismatch, and the cases where it must stay quiet |
| `test/batch.test.js` | batch rows, and CSV cells that a spreadsheet would otherwise execute |
| `test/entropy.test.js` | entropy per block, and the minimum block size |
| `test/i18n.test.js` | the Japanese and English dictionaries hold the same keys, and every key the UI asks for exists |

Contrast, tap target sizes, narrow screens and CSP violations are checked by hand with Playwright rather than in these tests.

---

## 📂 Layout

```
magic-sign-inspector/
├── index.html                  # the page
├── style.css
├── package.json                # test runner only; no dependencies
├── js/
│   ├── app.js                  # the application
│   ├── i18n.js                 # Japanese and English text
│   ├── dict.js                 # dictionary validation, foremost.conf
│   ├── search.js               # hex search
│   ├── appended.js             # data past the end of the file
│   ├── extcheck.js             # extension mismatch
│   ├── batch.js                # batch rows and CSV
│   ├── entropy.js              # entropy per block
│   ├── fileinfo.js             # file details, hashes, Exif link
│   ├── hexview.js              # hex view with virtual scrolling
│   ├── shortcuts.js            # keyboard
│   └── worker.js               # the scan itself
│   #  the five above fileinfo.js touch no DOM, so they are tested directly
├── sigs/                       # 184 signatures in four files
│   ├── default.json            # 54
│   ├── enhanced.json           # 67
│   ├── forensics.json          # 40
│   └── trailers.json           # 23
└── test/
```

---

## 📚 More

- **[TECHNICAL.md](TECHNICAL.md)** — how the scan, the offsets and the trailer check work (Japanese)
- **[DEVELOPMENT.md](DEVELOPMENT.md)** — development notes (Japanese)

### Related tool

- [Image Exif Checker](https://github.com/ipusiron/image-exif-checker) — once you know a file is a JPEG or PNG, this reads its Exif metadata

---

## 📄 License

MIT License — see [LICENSE](LICENSE).

---

## 🛠 About this project

This tool is part of **100 Security Tools with Generative AI**, in which one security-related tool is built and published each day with the help of generative AI.

🔗 [https://akademeia.info/?page_id=42163](https://akademeia.info/?page_id=42163)
