// /admin/update/ の Hugo のバージョン。ビルドの設定ファイルに書かれた Hugo のバージョンを読み、変更してコミットする。
// GitHub Actions のワークフロー（peaceiris/actions-hugo の hugo-version）と .gitlab-ci.yml（Hugo 公式のイメージのタグ）に対応する
import { getToken, siteFiles } from './backend.js';
import { t } from './i18n.js';
import { decodeBase64, encodeBase64 } from './site-config.js';

const $ = (id) => document.getElementById(id);
const settings = JSON.parse($('admin-update-config').textContent);
const token = sessionStorage.getItem('gh_admin_settings_token') || getToken() || '';

const VERSION_RE = /^\d+\.\d+\.\d+$/;

// ビルドの設定ファイルのパスと、Hugo のバージョンを書いている箇所。書き換えは、バージョンの部分だけを置き換える
export function buildFile({ provider, buildWorkflow }) {
  if (provider === 'gitlab') {
    return { path: '.gitlab-ci.yml', pattern: /(ghcr\.io\/gohugoio\/hugo:v|hugomods\/hugo:(?:[a-z-]+-)?)(\d+\.\d+\.\d+)/ };
  }
  if (!buildWorkflow) return null;
  return { path: `.github/workflows/${buildWorkflow}`, pattern: /(hugo-version:\s*["']?)(\d+\.\d+\.\d+)/ };
}

export function readHugoVersion(text, file) {
  return file.pattern.exec(text)?.[2] ?? null;
}

export function writeHugoVersion(text, file, version) {
  return text.replace(new RegExp(file.pattern.source, 'g'), (_, prefix) => `${prefix}${version}`);
}

function status(message, error = false) {
  const el = $('admin-hugo-status');
  el.textContent = message;
  el.classList.toggle('error', error);
}

async function latestHugo() {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token && (settings.provider ?? 'github') === 'github') headers.Authorization = `Bearer ${token}`;
  const res = await fetch('https://api.github.com/repos/gohugoio/hugo/releases/latest', { headers });
  if (!res.ok) throw new Error(t('settings.hugo_latest_failed'));
  const tag = (await res.json()).tag_name?.replace(/^v/, '');
  if (!VERSION_RE.test(tag ?? '')) throw new Error(t('settings.hugo_latest_failed'));
  return tag;
}

async function main() {
  const file = buildFile(settings);
  if (!file || !settings.buildRepo) {
    status(t('settings.hugo_unsupported'));
    return;
  }
  if (!token) return;
  const files = siteFiles({ repo: settings.buildRepo, branch: settings.buildBranch }, token);
  const input = $('admin-hugo-version');
  let found = await files.getFile(file.path);
  const current = found && readHugoVersion(decodeBase64(found.base64), file);
  if (!current) {
    status(t('settings.hugo_not_found', { file: file.path }));
    return;
  }
  input.value = current;
  $('admin-hugo-form').hidden = false;
  status(t('settings.hugo_file', { file: file.path }));

  $('admin-hugo-latest').addEventListener('click', async () => {
    try {
      input.value = await latestHugo();
    } catch (error) {
      status(error.message, true);
    }
  });

  $('admin-hugo-save').addEventListener('click', async () => {
    const version = input.value.trim().replace(/^v/, '');
    if (!VERSION_RE.test(version)) {
      status(t('settings.hugo_invalid'), true);
      return;
    }
    const save = $('admin-hugo-save');
    save.disabled = true;
    status(t('settings.saving'));
    try {
      const before = decodeBase64(found.base64);
      const after = writeHugoVersion(before, file, version);
      if (after === before) {
        status(t('settings.pin_unchanged'));
        return;
      }
      await files.putFile(file.path, encodeBase64(after), `Build with Hugo ${version}`, found.version);
      found = await files.getFile(file.path);
      status(t('settings.hugo_saved', { file: file.path }));
    } catch (error) {
      status(error.message, true);
    } finally {
      save.disabled = false;
    }
  });
}

main().catch((error) => status(error.message, true));
