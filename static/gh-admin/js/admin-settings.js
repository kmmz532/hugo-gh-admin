// /admin-settings/ 専用のサイト設定画面。既存の /admin/ の認証・画面には手を加えない。
import { getToken } from './github.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const settings = JSON.parse($('admin-settings-config').textContent);
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
  if (!response.ok) {
    const message = body.message || `GitHub API error: ${response.status}`;
    if (response.status === 403 && /Resource not accessible by personal access token/i.test(message)) {
      throw new Error(t('settings.repo_write_denied', { repo: settings.repo }));
    }
    throw new Error(message);
  }
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
    body: JSON.stringify({ message, content, branch: settings.branch, ...(sha ? { sha } : {}) }),
  });
}

async function connect(candidate) {
  if (!candidate) throw new Error(t('settings.token_required'));
  token = candidate;
  const repository = await api(`/repos/${settings.repo}`);
  if (repository.permissions?.push !== true) {
    throw new Error(t('settings.repo_no_write', { repo: settings.repo }));
  }
  const file = await getFile(settings.path);
  sessionStorage.setItem(TOKEN_KEY, token);
  configFile = file;
  loadForm(decodeBase64(file.content));
  $('admin-settings-settings-form').hidden = false;
  $('admin-settings-auth-form').hidden = true;
  status('admin-settings-auth-status', t('settings.connected', { repo: settings.repo }));
  status('admin-settings-status', '');
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
  let start = 0;
  let end = lines.length;
  if (table) {
    const range = sectionRange(lines, table);
    if (!range) {
      if (lines.length && lines.at(-1).trim()) lines.push('');
      lines.push(`[${table}]`, `  ${key} = ${JSON.stringify(value)}`);
      return;
    }
    start = range.start + 1;
    end = range.end;
  } else {
    end = lines.findIndex((line) => /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
  }

  const index = lines.findIndex((line, i) => i >= start && i < end && new RegExp(`^\\s*${key}\\s*=`).test(line));
  const indent = table && index >= 0 ? lines[index].match(/^\s*/)[0] : (table ? '  ' : '');
  const replacement = `${indent}${key} = ${JSON.stringify(value)}`;
  if (index >= 0) lines[index] = replacement;
  else lines.splice(end, 0, replacement);
}

function showPreview(id, path) {
  const image = $(id === 'icon' ? 'admin-settings-icon-preview' : 'admin-settings-thumbnail-preview');
  const label = $(id === 'icon' ? 'admin-settings-icon-path' : 'admin-settings-thumbnail-path');
  label.textContent = path || '未設定';
  if (path) {
    image.src = new URL(path, location.origin).href;
    image.hidden = false;
  } else {
    image.removeAttribute('src');
    image.hidden = true;
  }
}

function loadForm(text) {
  const lines = text.split(/\r?\n/);
  $('admin-settings-title').value = readString(lines, 'title');
  showPreview('icon', readString(lines, 'icon', 'params'));
  showPreview('thumbnail', readString(lines, 'defaultThumbnail', 'params'));
}

async function uploadAsset(file, prefix, allowedExtensions, maxSize) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (!allowedExtensions.includes(extension)) throw new Error(t('settings.extension_unsupported', { extensions: allowedExtensions.join('・') }));
  if (file.size > maxSize) throw new Error(t('settings.file_too_large', { size: Math.floor(maxSize / 1024 / 1024) }));

  const path = `static/${prefix}.${extension}`;
  let existing = null;
  try {
    existing = await getFile(path);
  } catch (error) {
    if (!String(error.message).includes('Not Found')) throw error;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  let saved;
  try {
    saved = await putFile(path, btoa(binary), `Update site ${prefix}`, existing?.sha);
  } catch (error) {
    throw new Error(`${t('settings.upload_failed')} (GitHub API: ${error.message})`);
  }
  if (saved.content?.path !== path || !saved.content?.sha) {
    throw new Error(`${t('settings.upload_failed')} (GitHub API response did not include the saved file)`);
  }

  let verified;
  try {
    verified = await getFile(path);
  } catch (error) {
    throw new Error(`${t('settings.upload_failed')} (verification failed: ${error.message})`);
  }
  if (verified.path !== path || verified.sha !== saved.content.sha) {
    throw new Error(`${t('settings.upload_failed')} (uploaded file SHA does not match)`);
  }
  return `/${path.slice('static/'.length)}`;
}

$('admin-settings-auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  status('admin-settings-auth-status', t('settings.connecting'));
  try {
    await connect($('admin-settings-token').value.trim());
  } catch (error) {
    status('admin-settings-auth-status', error.message, true);
  }
});

$('admin-settings-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('admin-settings-settings-form').querySelector('button[type="submit"]');
  button.disabled = true;
  status('admin-settings-status', t('settings.saving'));
  try {
    const lines = decodeBase64(configFile.content).split(/\r?\n/);
    const title = $('admin-settings-title').value.trim();
    if (!title) throw new Error(t('settings.title_required'));
    writeString(lines, 'title', title);

    const favicon = $('admin-settings-favicon').files[0];
    if (favicon) {
      const iconPath = await uploadAsset(favicon, 'favicon', ['ico', 'png', 'svg'], 1024 * 1024);
      writeString(lines, 'icon', iconPath, 'params');
      if (favicon.name.toLowerCase().endsWith('.png')) writeString(lines, 'appleIcon', iconPath, 'params');
    }

    const thumbnail = $('admin-settings-thumbnail').files[0];
    if (thumbnail) {
      const thumbnailPath = await uploadAsset(thumbnail, 'default-thumbnail', ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'], 5 * 1024 * 1024);
      writeString(lines, 'defaultThumbnail', thumbnailPath, 'params');
    } else if ($('admin-settings-clear-thumbnail').checked) {
      writeString(lines, 'defaultThumbnail', '', 'params');
    }

    const result = await putFile(settings.path, encodeBase64(lines.join('\n')), 'Update blog appearance settings', configFile.sha);
    configFile = await getFile(settings.path);
    showPreview('icon', readString(lines, 'icon', 'params'));
    showPreview('thumbnail', readString(lines, 'defaultThumbnail', 'params'));
    $('admin-settings-favicon').value = '';
    $('admin-settings-thumbnail').value = '';
    $('admin-settings-clear-thumbnail').checked = false;
    status('admin-settings-status', t('settings.saved', { commit: result.commit?.sha?.slice(0, 7) || '完了' }));
  } catch (error) {
    if (/Fine-grained PAT/.test(error.message)) {
      // サイト設定用の権限が足りない場合、別の PAT を入力し直せるようにする。
      sessionStorage.removeItem(TOKEN_KEY);
      $('admin-settings-settings-form').hidden = true;
      $('admin-settings-auth-form').hidden = false;
      $('admin-settings-token').value = '';
      status('admin-settings-auth-status', error.message, true);
      status('admin-settings-status', '');
    } else {
      status('admin-settings-status', error.message, true);
    }
  } finally {
    button.disabled = false;
  }
});

if (token) {
  connect(token).catch((error) => {
    status('admin-settings-auth-status', t('settings.saved_token_invalid', { message: error.message }), true);
    $('admin-settings-auth-form').hidden = false;
  });
} else {
  $('admin-settings-auth-form').hidden = false;
}
