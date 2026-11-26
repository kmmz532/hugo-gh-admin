// サイト本体の設定ファイル（hugo.toml・go.mod）の読み書き。サイト設定と更新の画面で使う
import { t } from './i18n.js';

export function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// この画面が変更する TOML キーだけを対象に、該当セクション内の行を置換する。
// TOML 全体を再シリアライズしないため、他の設定・コメント・順序を保持する。
// セクションは次のテーブル見出し（[table] と [[table]] のどちらも）の手前まで
export const HEADER = /^\s*\[/;
export const KEY_LINE = /^\s*([A-Za-z0-9_-]+)\s*=(.*)$/;

export function sectionRange(lines, table) {
  const header = `[${table}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && HEADER.test(line));
  if (end < 0) end = lines.length;
  return { start, end };
}

// table が空ならファイル先頭（最初の見出しの手前まで）
export function scope(lines, table) {
  if (table) {
    const range = sectionRange(lines, table);
    return range ? { start: range.start + 1, end: range.end } : null;
  }
  const end = lines.findIndex((line) => HEADER.test(line));
  return { start: 0, end: end < 0 ? lines.length : end };
}

// 文字列・数値・真偽値だけを読む。それ以外（配列など）は undefined
export function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, value.lastIndexOf('"')); }
  }
  const bare = value.replace(/\s+#.*$/, '');
  if (bare === 'true' || bare === 'false') return bare === 'true';
  if (/^[+-]?\d+(\.\d+)?$/.test(bare)) return Number(bare);
  return undefined;
}

export function literal(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function readValue(lines, key, table = '') {
  const range = scope(lines, table);
  if (!range) return undefined;
  const line = lines.slice(range.start, range.end).find((item) => KEY_LINE.exec(item)?.[1] === key);
  return line === undefined ? undefined : parseValue(line.slice(line.indexOf('=') + 1));
}

export function readString(lines, key, table = '') {
  const value = readValue(lines, key, table);
  return typeof value === 'string' ? value : '';
}

// セクションの末尾の空行・コメント（次のセクションの説明）より前の位置
export function sectionTail(lines, range) {
  let at = range.end;
  while (at > range.start && (!lines[at - 1].trim() || lines[at - 1].trim().startsWith('#'))) at--;
  return at;
}

export function writeValue(lines, key, value, table = '') {
  const range = scope(lines, table);
  if (!range) {
    if (lines.length && lines.at(-1).trim()) lines.push('');
    lines.push(`[${table}]`, `  ${key} = ${literal(value)}`);
    return;
  }
  const index = lines.findIndex((line, i) => i >= range.start && i < range.end && KEY_LINE.exec(line)?.[1] === key);
  const indent = index >= 0 ? lines[index].match(/^\s*/)[0] : (table ? '  ' : '');
  const replacement = `${indent}${key} = ${literal(value)}`;
  if (index >= 0) lines[index] = replacement;
  else lines.splice(sectionTail(lines, range), 0, replacement);
}

export const writeString = writeValue;

// テーブルの配列（[[params.links]] など）。各要素の key = value の行だけを読む
export function readList(lines, path) {
  const header = `[[${path}]]`;
  const items = [];
  lines.forEach((line, index) => {
    if (line.trim() !== header) return;
    const item = {};
    for (let i = index + 1; i < lines.length && KEY_LINE.test(lines[i]); i++) {
      const [, key, raw] = KEY_LINE.exec(lines[i]);
      item[key] = parseValue(raw);
    }
    items.push(item);
  });
  return items;
}

// 既存の要素をすべて取り除き、最初の要素があった位置（なければ親のテーブルの末尾）に書き直す
export function writeList(lines, path, items, columns) {
  const header = `[[${path}]]`;
  let at = -1;
  let indent = '';
  for (let i = 0; i < lines.length;) {
    if (lines[i].trim() !== header) { i++; continue; }
    if (at < 0) { at = i; indent = lines[i].match(/^\s*/)[0]; }
    let j = i + 1;
    while (j < lines.length && KEY_LINE.test(lines[j])) j++;
    lines.splice(i, j - i);
  }
  if (!items.length) return;
  if (at < 0) {
    const table = path.split('.').slice(0, -1).join('.');
    if (table && !sectionRange(lines, table)) {
      if (lines.length && lines.at(-1).trim()) lines.push('');
      lines.push(`[${table}]`);
    }
    at = table ? sectionTail(lines, scope(lines, table)) : lines.length;
    indent = table ? '  ' : '';
  }
  const block = items.flatMap((item) => [
    `${indent}${header}`,
    ...columns
      .filter((c) => item[c.key] !== '' && item[c.key] !== undefined)
      .map((c) => `${indent}  ${c.key} = ${literal(item[c.key])}`),
  ]);
  lines.splice(at, 0, ...block);
}

// Hugo Modules。[[module.imports]] の path と、go.mod の require を扱う
export function readModuleImports(lines) {
  return readList(lines, 'module.imports').map((item) => item.path).filter((path) => typeof path === 'string');
}

export function replaceModuleImport(lines, from, to) {
  let inImport = false;
  for (let i = 0; i < lines.length; i++) {
    if (HEADER.test(lines[i])) { inImport = lines[i].trim() === '[[module.imports]]'; continue; }
    const match = inImport && KEY_LINE.exec(lines[i]);
    if (match && match[1] === 'path' && parseValue(match[2]) === from) {
      lines[i] = `${lines[i].match(/^\s*/)[0]}path = ${literal(to)}`;
      return true;
    }
  }
  return false;
}

// go.mod の require（パス → バージョン）。require ( ... ) と require <path> <version> の両方を読む
export function readGoRequires(text) {
  const requires = new Map();
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^require\s*\($/.test(trimmed)) { inBlock = true; continue; }
    if (inBlock && trimmed === ')') { inBlock = false; continue; }
    const match = inBlock ? /^(\S+)\s+(\S+)/.exec(trimmed) : /^require\s+(\S+)\s+(\S+)/.exec(trimmed);
    if (match && !match[1].startsWith('//')) requires.set(match[1], match[2]);
  }
  return requires;
}

// prefix で始まるモジュールの require を取り除き、entries（[パス, バージョン]）を追加する
export function writeGoRequires(text, prefix, entries) {
  const out = [];
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^require\s*\($/.test(trimmed)) { inBlock = true; out.push(line); continue; }
    if (inBlock && trimmed === ')') {
      inBlock = false;
      // 空になった require ( ) は消す
      if (/^require\s*\($/.test(out.at(-1)?.trim() ?? '')) out.pop();
      else out.push(line);
      continue;
    }
    const match = inBlock ? /^(\S+)\s+\S+/.exec(trimmed) : /^require\s+(\S+)\s+\S+/.exec(trimmed);
    if (match && match[1].startsWith(prefix)) continue;
    out.push(line);
  }
  while (out.length && !out.at(-1).trim()) out.pop();
  if (entries.length) out.push('', 'require (', ...entries.map(([path, version]) => `\t${path} ${version}`), ')');
  return `${out.join('\n')}\n`;
}

// versions（パス → バージョン）の require を書き換える。go.mod に無いモジュール（テーマ経由の間接的な依存など）は
// require を追加する。Go は依存のうち最も高いバージョンを選ぶため、サイトの go.mod に書けばテーマの指定より優先される
export function setGoRequires(text, versions) {
  const rest = new Map(versions);
  const lines = text.split(/\r?\n/).map((line) => {
    const match = /^(\s*(?:require\s+)?)(\S+)(\s+)(\S+)(.*)$/.exec(line);
    // replace（「=>」を含む行）は書き換えない
    if (!match || !rest.has(match[2]) || line.includes('=>')) return line;
    const version = rest.get(match[2]);
    rest.delete(match[2]);
    return `${match[1]}${match[2]}${match[3]}${version}${match[5].replace(/\s*\/\/\s*indirect\s*$/, '')}`;
  });
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (rest.size) lines.push('', 'require (', ...[...rest].map(([path, version]) => `\t${path} ${version}`), ')');
  return `${lines.join('\n')}\n`;
}

// GitHub のリポジトリの最新コミットから Go modules の疑似バージョンを作る（例: v0.0.0-20261126012345-0123456789ab）
export async function latestPseudoVersion(source, branch = 'main') {
  const res = await fetch(`https://api.github.com/repos/${source}/commits/${encodeURIComponent(branch)}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(t('settings.module_version_failed', { message: `${res.status} ${res.statusText}` }));
  const data = await res.json();
  const time = new Date(data.commit.committer.date).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `v0.0.0-${time}-${data.sha.slice(0, 12)}`;
}


// ---- テーマ（[[module.imports]] の先頭の、管理画面以外のモジュール） ----

export const ADMIN_MODULE = 'github.com/kmmz532/hugo-gh-admin';
// themes.gohugo.io に載っているテーマの一覧（1 行に 1 つのモジュールのパス）
export const HUGO_THEMES_LIST_URL = 'https://raw.githubusercontent.com/gohugoio/hugoThemesSiteBuilder/main/themes.txt';

const MODULE_PATH_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[A-Za-z0-9._~-]+)+$/;

export function parseThemesList(text) {
  return text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && MODULE_PATH_RE.test(line));
}

// テーマの入力（モジュールのパス・リポジトリの URL・themes.gohugo.io のテーマのページの URL）をモジュールのパスにする。
// 受け付けない形なら null。themes は themes.gohugo.io の一覧（テーマのページの URL を変換するときに使う）
export function normalizeThemeModule(input, themes = []) {
  const page = /^(?:https?:\/\/)?themes\.gohugo\.io\/themes\/([^/?#]+)/i.exec(input.trim());
  if (page) {
    const name = page[1].toLowerCase();
    const nameOf = (theme) => theme.replace(/\/v\d+$/, '').split('/').pop().toLowerCase();
    return themes.find((theme) => nameOf(theme) === name) ?? null;
  }
  let path = input.trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const [host = '', ...rest] = path.split('/');
  path = [host.toLowerCase(), ...rest].join('/');
  // GitHub はリポジトリまで（/tree/main などのページの URL を除く）。GitLab は /-/ 以降がページの URL
  if (host.toLowerCase() === 'github.com') path = path.split('/').slice(0, 3).join('/');
  path = path.replace(/\/-\/.*$/, '');
  return path.length <= 200 && MODULE_PATH_RE.test(path) && path !== ADMIN_MODULE ? path : null;
}

// 今のテーマ。管理画面のモジュールを除いた、最初の [[module.imports]]。無ければ undefined
export const currentTheme = (lines) => readModuleImports(lines).find((path) => path !== ADMIN_MODULE);

// 管理画面のモジュールを取り込んでいなければ、末尾に追加する。テーマが取り込まない場合（外部テーマ）に必要。追加したら true
export function ensureAdminImport(lines) {
  if (readModuleImports(lines).includes(ADMIN_MODULE)) return false;
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  lines.push('', '# 管理画面（hugo-gh-admin）', '[[module.imports]]', `  path = ${literal(ADMIN_MODULE)}`, '');
  return true;
}
