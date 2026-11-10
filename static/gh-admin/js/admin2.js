// /admin2/ 専用のサイト設定画面。既存の /admin/ の認証・画面には手を加えない。
import { getToken } from './github.js';

const $ = (id) => document.getElementById(id);
const settings = JSON.parse($('admin2-config').textContent);
const API = 'https://api.github.com';
const TOKEN_KEY = 'gh_admin2_token';
let token = sessionStorage.getItem(TOKEN_KEY) || getToken() || '';
let configFile = null;

function status(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('error', error);
}

function headers() {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || `GitHub API error: ${response.status}`);
  return body;
}

const apiPath = (path) => path.split('/').map(encodeURIComponent).join('/');

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function getFile(path) {
  return api(`/repos/${settings.repo}/contents/${apiPath(path)}?ref=${encodeURIComponent(settings.branch)}`);
}

async function putFile(path, content, message, sha) {
  return api(`/repos/${settings.repo}/contents/${apiPath(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content,
      branch: settings.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

async function connect(candidate) {
  if (!candidate) throw new Error('Personal access token を入力してほしい。');
  token = candidate;
  const repository = await api(`/repos/${settings.repo}`);
  if (repository.permissions?.push !== true) {
    throw new Error(`このトークンには ${settings.repo} への書き込み権限がない。`);
  }
  const file = await getFile(settings.path);
  sessionStorage.setItem(TOKEN_KEY, token);
  configFile = file;
  loadForm(decodeBase64(file.content));
  $('admin2-settings-form').hidden = false;
  status('admin2-auth-status', `接続済み: ${settings.repo}`);
  status('admin2-status', '');
}

// この画面が変更する TOML キーだけを対象に、該当セクション内の行を置換する。
// TOML 全体を再シリアライズしないため、他の設定・コメント・順序を保持する。
function sectionRange(lines, table) {
  const header = `[${table}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return null;
  let end = lines.findIndex((line, index) => index > start && /^\s*\[[^\]]+\]\s*$/.test(line));
  if (end < 0) end = lines.length;
  return { start, end };
}

function readString(lines, key, table = '') {
  let start = 0;
  let end = lines.length;
  if (table) {
    const range = sectionRange(lines, table);
    if (!range) return '';
    start = range.start + 1;
    end = range.end;
  } else {
    end = lines.findIndex((line) => /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
  }
  const line = lines.slice(start, end).find((item) => new RegExp(`^\\s*${key}\\s*=`).test(item));
  if (!line) return '';
  const value = line.slice(line.indexOf('=') + 1).trim();
  if (!value.startsWith('"')) return '';
  try { return JSON.parse(value); } catch { return value.slice(1, value.lastIndexOf('"')); }
}

function writeString(lines, key, value, table = '') {
  const replacement = `  ${key} = ${JSON.stringify(value)}`;
  let start = 0;
  let end = lines.length;
  if (table) {
    let range = sectionRange(lines, table);
    if (!range) {
      if (lines.length && lines.at(-1).trim()) lines.push('');
      lines.push(`[${table}]`, replacement);
      return;
    }
    start = range.start + 1;
    end = range.end;
  } else {
    end = lines.findIndex((line) => /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
  }
  const index = lines.findIndex((line, i) => i >= start && i < end && new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (index >= 0) lines[index] = replacement;
  else lines.splice(end, 0, replacement);
}

function loadForm(text) {
  const lines = text.split(/\r?\n/);
  $('admin2-title').value = readString(lines, 'title');
  const icon = readString(lines, 'icon', 'params');
  $('admin2-icon-path').textContent = icon || '未設定';
  if (icon) {
    $('admin2-icon-preview').src = new URL(icon, location.origin).href;
    $('admin2-icon-preview').hidden = false;
  }
}

async function uploadIcon(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (!['ico', 'png', 'svg'].includes(extension)) throw new Error('ICO・PNG・SVGファイルを選択してほしい。');
  if (file.size > 1024 * 1024) throw new Error('ファビコンは1MB以下にしてほしい。');

  const path = `static/favicon.${extension}`;
  let existing = null;
  try {
    existing = await getFile(path);
  } catch (error) {
    if (!String(error.message).includes('Not Found')) throw error;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  await putFile(path, btoa(binary), 'Update site favicon', existing?.sha);
  return `/${path.slice('static/'.length)}`;
}

$('admin2-auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  status('admin2-auth-status', 'GitHub に接続中…');
  try {
    await connect($('admin2-token').value.trim() || token);
  } catch (error) {
    status('admin2-auth-status', error.message, true);
    $('admin2-settings-form').hidden = true;
  }
});

$('admin2-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('admin2-settings-form').querySelector('button[type="submit"]');
  button.disabled = true;
  status('admin2-status', '保存中…');
  try {
    const lines = decodeBase64(configFile.content).split(/\r?\n/);
    const title = $('admin2-title').value.trim();
    if (!title) throw new Error('ブログ名を入力してほしい。');
    writeString(lines, 'title', title);
    writeString(lines, 'headerTitle', title, 'params');

    const file = $('admin2-favicon').files[0];
    if (file) {
      const iconPath = await uploadIcon(file);
      writeString(lines, 'icon', iconPath, 'params');
      if (file.name.toLowerCase().endsWith('.png')) {
        writeString(lines, 'appleIcon', iconPath, 'params');
      }
    }

    const result = await putFile(settings.path, encodeBase64(lines.join('\n')), 'Update blog appearance settings', configFile.sha);
    configFile = await getFile(settings.path);
    const icon = readString(lines, 'icon', 'params');
    $('admin2-icon-path').textContent = icon || '未設定';
    if (icon) {
      $('admin2-icon-preview').src = new URL(icon, location.origin).href;
      $('admin2-icon-preview').hidden = false;
    }
    $('admin2-favicon').value = '';
    status('admin2-status', `保存した。コミット: ${result.commit?.sha?.slice(0, 7) || '完了'}。サイトの再ビルド後に反映される。`);
  } catch (error) {
    status('admin2-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});

if (token) {
  connect(token).catch((error) => {
    status('admin2-auth-status', `既存の認証情報では接続できない。ブログ本体リポジトリ用の PAT を入力してほしい。詳細: ${error.message}`, true);
  });
}
