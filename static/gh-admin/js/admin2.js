// /admin2/ 専用のサイト設定画面。既存の /admin/ の認証・画面には手を加えない。
import { getToken } from './github.js';

const $ = (id) => document.getElementById(id);
const settings = JSON.parse($('admin2-config').textContent);
const API = 'https://api.github.com';
const TOKEN_KEY = 'gh_admin2_token';
let token = sessionStorage.getItem(TOKEN_KEY) || getToken() || '';
let configFile = null;
let currentIcon = '';

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
  if (!response.ok) {
    throw new Error(body.message || `GitHub API error: ${response.status}`);
  }
  return body;
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\\s/g, ''));
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
  return api(`/repos/${settings.repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/') }?ref=${encodeURIComponent(settings.branch)}`);
}

async function putFile(path, content, message, sha) {
  return api(`/repos/${settings.repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/') }`, {
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
  token = candidate;
  const repository = await api(`/repos/${settings.repo}`);
  if (repository.permissions?.push !== true) {
    throw new Error(`このトークンには ${settings.repo} への書き込み権限がない。`);
  }
  sessionStorage.setItem(TOKEN_KEY, token);
  configFile = await getFile(settings.path);
  const text = decodeBase64(configFile.content);
  loadForm(text);
  $('admin2-settings-form').hidden = false;
  status('admin2-auth-status', `接続済み: ${settings.repo}`);
  status('admin2-status', '');
}

function findTomlString(text, key, table = '') {
  const escaped = key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&');
  if (!table) {
    const match = text.match(new RegExp(`^\\s*${escaped}\\s*=\\s*"((?:\\\\.|[^"])*)"`, 'm'));
    return match?.[1] ?? '';
  }
  const section = text.match(new RegExp(`^\\[${table.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\s*$([\\s\\S]*?)(?=^\\[|$)`, 'm'));
  const match = section?.[1].match(new RegExp(`^\\s*${escaped}\\s*=\\s*"((?:\\\\.|[^"])*)"`, 'm'));
  return match?.[1] ?? '';
}

function tomlQuote(value) {
  return JSON.stringify(value);
}

function setTomlValue(text, key, value, table = '') {
  const line = `${key} = ${tomlQuote(value)}`;
  if (!table) {
    const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    if (!pattern.test(text)) throw new Error(`hugo.toml に ${key} の設定が見つからない。`);
    return text.replace(pattern, line);
  }

  const header = new RegExp(`^\\[${table}\\]\\s*$`, 'm');
  const match = header.exec(text);
  if (!match) return `${text.trimEnd()}\\n\\n[${table}]\\n${line}\\n`;
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = /^\\s*\\[[^\\]]+\\]\\s*$/m.exec(rest);
  const end = next ? start + next.index : text.length;
  const section = text.slice(start, end);
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  const updated = pattern.test(section)
    ? section.replace(pattern, line)
    : `${section.replace(/\\s*$/, '')}\\n${line}\\n`;
  return text.slice(0, start) + updated + text.slice(end);
}

function loadForm(text) {
  $('admin2-title').value = findTomlString(text, 'title');
  currentIcon = findTomlString(text, 'icon', 'params');
  $('admin2-icon-path').textContent = currentIcon || '未設定';
  if (currentIcon) {
    const image = $('admin2-icon-preview');
    image.src = new URL(currentIcon, location.origin).href;
    image.hidden = false;
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
  const supplied = $('admin2-token').value.trim();
  status('admin2-auth-status', 'GitHub に接続中…');
  try {
    await connect(supplied || token);
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
    let text = decodeBase64(configFile.content);
    const title = $('admin2-title').value.trim();
    if (!title) throw new Error('ブログ名を入力してほしい。');
    text = setTomlValue(text, 'title', title);
    text = setTomlValue(text, 'headerTitle', title, 'params');

    const file = $('admin2-favicon').files[0];
    if (file) {
      const iconPath = await uploadIcon(file);
      text = setTomlValue(text, 'icon', iconPath, 'params');
      if (file.name.toLowerCase().endsWith('.png')) {
        text = setTomlValue(text, 'appleIcon', iconPath, 'params');
      }
    }

    const saved = await putFile(settings.path, encodeBase64(text), 'Update blog appearance settings', configFile.sha);
    configFile = await getFile(settings.path);
    currentIcon = findTomlString(text, 'icon', 'params');
    $('admin2-icon-path').textContent = currentIcon || '未設定';
    if (currentIcon) {
      $('admin2-icon-preview').src = new URL(currentIcon, location.origin).href;
      $('admin2-icon-preview').hidden = false;
    }
    $('admin2-favicon').value = '';
    status('admin2-status', `保存した。コミット: ${saved.commit?.sha?.slice(0, 7) || '完了'}。サイトの再ビルド後に反映される。`);
  } catch (error) {
    status('admin2-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});

if (token) {
  connect(token).catch((error) => {
    sessionStorage.removeItem(TOKEN_KEY);
    status('admin2-auth-status', `既存の認証情報では接続できない。ブログ本体リポジトリ用の PAT を入力してほしい。詳細: ${error.message}`, true);
  });
}
