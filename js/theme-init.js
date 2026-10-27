/**
 * theme-init - 最初の描画の前にテーマを決める。<head> の stylesheet の直後で同期読み込みする。
 *
 * style.css の既定はライトで、ダークは <html> の dark クラスで切り替える。
 * この判定をモジュールの app.js（DOMContentLoaded のあと）で行うと、
 * ライトで描いたあとにダークへ切り替わって見える。
 *
 * 判定は app.js の applyTheme と同じ: 保存値 msi_theme が無ければ "auto" として OS の設定に従い、
 * "dark" ならダーク、それ以外はライト。localStorage が読めない環境でも落ちないよう try/catch で囲む。
 */
(function (global) {
  "use strict";

  var saved = null;
  try { saved = global.localStorage.getItem("msi_theme"); } catch (e) { /* 使えない環境でも続行 */ }

  var mode = saved || "auto";
  var preferDark = !!(global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches);
  var isDark = mode === "dark" || (mode === "auto" && preferDark);

  if (isDark) global.document.documentElement.classList.add("dark");
})(typeof window !== "undefined" ? window : globalThis);
