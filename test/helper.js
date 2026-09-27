import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

/**
 * worker.js は Web Worker 用の素のスクリプトなので、
 * Node から読むために self の最小の代わりを渡す。
 * 送られたメッセージは messages へ貯める。
 */
export function loadWorker() {
  const source = read("js/worker.js");
  const messages = [];
  const listeners = [];
  const self = {
    addEventListener(type, fn) { if (type === "message") listeners.push(fn); },
    postMessage(msg) { messages.push(msg); }
  };
  const factory = new Function("self", "performance", `${source}
    return { compileSig, matchAt, findTrailer, compileParts };`);
  const api = factory(self, { now: () => 0 });
  return {
    ...api,
    messages,
    async scan(payload) {
      messages.length = 0;
      await listeners[0]({ data: { cmd: "scan", ...payload } });
      // 非同期の走査が終わるのを待つ
      for (let i = 0; i < 200 && !messages.some((m) => m.type === "done" || m.type === "error"); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return messages.find((m) => m.type === "done" || m.type === "error");
    }
  };
}

/**
 * i18n.js は通常のスクリプトなので、Node からは関数として読む。
 * window も localStorage も無い環境で読めることを、ここで確かめていることになる。
 */
export function loadI18n() {
  return new Function(`${read("js/i18n.js")}
    return I18n;`)();
}

/** dict.js や worker.js が返す { key, params } を、実際の文言にする */
export function render(issue, I18n) {
  return I18n.t(issue.key, issue.params || {});
}

/** 16進数の並びを ArrayBuffer にする */
export function bytes(hex) {
  const values = hex.trim().split(/\s+/).map((h) => parseInt(h, 16));
  return new Uint8Array(values).buffer;
}

export function concat(...buffers) {
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const b of buffers) { out.set(new Uint8Array(b), at); at += b.byteLength; }
  return out.buffer;
}

export function zeros(n) {
  return new Uint8Array(n).buffer;
}
