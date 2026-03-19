/**
 * utils.js — 纯工具函数
 *
 * 不依赖 state / DOM 引用的通用工具。
 * 部分函数依赖全局 t() (i18n)，但无其他副作用。
 * 通过 window.HanaModules.utils 暴露。
 */
(function () {

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** 简易 CSV 解析（支持引号包裹的字段） */
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(field); field = "";
        if (row.some(c => c !== "")) rows.push(row);
        row = [];
        if (ch === '\r') i++;
      } else field += ch;
    }
  }
  row.push(field);
  if (row.some(c => c !== "")) rows.push(row);
  return rows;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

function isImageFile(name) {
  const ext = (name || "").toLowerCase().replace(/^.*(\.\w+)$/, "$1");
  return IMAGE_EXTS.has(ext);
}

/** 给 md-content 里的代码块注入复制按钮 */
function injectCopyButtons(container) {
  const pres = container.querySelectorAll("pre");
  for (const pre of pres) {
    if (pre.querySelector(".copy-btn")) continue;
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = t("attach.copy");
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code");
      const text = code ? code.textContent : pre.textContent;
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = t("attach.copied");
        setTimeout(() => { btn.textContent = t("attach.copy"); }, 1500);
      });
    });
    pre.style.position = "relative";
    pre.appendChild(btn);
  }
}

// 暴露到全局命名空间
window.HanaModules = window.HanaModules || {};
window.HanaModules.utils = {
  escapeHtml, parseCSV, isImageFile, injectCopyButtons, IMAGE_EXTS,
};

})();
