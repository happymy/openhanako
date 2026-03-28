/**
 * ESM cache-busting import.
 * 每次调用都用唯一 timestamp query 绕过 Node.js 的模块缓存。
 * @param {string} filePath 绝对路径
 * @returns {Promise<any>} module namespace
 */
let _counter = 0;
export async function freshImport(filePath) {
  return import(`${filePath}?t=${Date.now()}-${_counter++}`);
}
