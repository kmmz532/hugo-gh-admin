// 画面の文言。辞書は 2 つの場所から読む。全ページで使うもの（meta の messages）と、管理画面だけのもの（gh-admin-messages）。
// 辞書の文字列は HTML として扱わない。t() の戻り値は textContent で描画する。
import { config } from './config.js';

export const lang = config.lang ?? 'en';

const adminEl = document.getElementById('gh-admin-messages');
const adminMessages = adminEl ? JSON.parse(adminEl.textContent) : {};

// 画面ごとの区分（section）を両方から合わせる
const messages = {};
for (const part of [config.messages, adminMessages]) {
  for (const [section, values] of Object.entries(part ?? {})) {
    messages[section] = { ...messages[section], ...values };
  }
}

// key は <画面>.<項目>。差し込みは {name} の形。無いキーはキー名をそのまま返す（画面が壊れないように）
export function t(key, vars = {}) {
  const [section, name] = key.split('.');
  const text = messages[section]?.[name];
  if (text === undefined) {
    console.warn(`文言のキーがありません: ${key}`);
    return key;
  }
  return text.replace(/\{(\w+)\}/g, (match, field) => (field in vars ? String(vars[field]) : match));
}
