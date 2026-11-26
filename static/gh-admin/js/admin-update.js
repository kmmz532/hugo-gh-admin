// /admin/update/ の更新の画面。ビルドに使ったモジュールのバージョンと最新バージョンを表示し、
// 古いモジュールをサイトの go.mod で最新バージョンに上げてから再ビルドする
import { getToken, siteFiles, startBuild } from './backend.js';
import { t } from './i18n.js';
import { decodeBase64, encodeBase64, latestPseudoVersion, readGoRequires, readModuleImports, setGoRequires, writeGoRequires } from './site-config.js';

const $ = (id) => document.getElementById(id);
const settings = JSON.parse($('admin-update-config').textContent);
// サイト設定の画面で入力したトークンがあれば、そちらを優先する
const token = sessionStorage.getItem('gh_admin_settings_token') || getToken() || '';

function status(id, message, error = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('error', error);
}

// GitHub にあるモジュール（github.com/<owner>/<repo>/...）の最新バージョン。タグのバージョンならタグ、疑似バージョン（v0.0.0-日時-SHA）なら既定のブランチの最新コミットと比べる
async function latestVersion(path, version) {
  const match = /^github\.com\/([^/]+)\/([^/]+)/.exec(path);
  if (!match) return null;
  const repo = `${match[1]}/${match[2]}`;
  const pseudo = /^v0\.0\.0-\d{14}-([0-9a-f]{12})$/.exec(version ?? '');
  if (pseudo || !version) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const time = new Date(data.commit.committer.date).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return { label: `v0.0.0-${time}-${data.sha.slice(0, 12)}`, same: pseudo ? data.sha.startsWith(pseudo[1]) : null };
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=100`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) return null;
  const parse = (v) => (/^v(\d+)\.(\d+)\.(\d+)$/.exec(v) ?? []).slice(1).map(Number);
  const tags = (await res.json()).map((tag) => tag.name).filter((name) => parse(name).length === 3)
    .sort((a, b) => { const x = parse(a); const y = parse(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; });
  return tags[0] ? { label: tags[0], same: tags[0] === version } : null;
}

// モジュールのパス → 最新バージョンの取得（再ビルドのときに、古いものを go.mod で上げるために使う）
const latestVersions = new Map();

function loadVersions() {
  const rows = $('admin-update-rows');
  rows.replaceChildren();
  for (const module of settings.modules ?? []) {
    const row = document.createElement('tr');
    const cells = [module.path, module.version || t('settings.version_local'), t('common.loading')].map((text) => {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
      return cell;
    });
    rows.append(row);
    const pending = latestVersion(module.path, module.version);
    if (module.version) latestVersions.set(module.path, pending.catch(() => null));
    pending.then((latest) => {
      cells[2].textContent = !latest ? '-' : latest.same ? t('settings.version_up_to_date') : latest.label;
      if (latest && latest.same === false) row.classList.add('outdated');
    }).catch(() => { cells[2].textContent = '-'; });
  }
}

const siteRepo = () => settings.siteRepo || settings.buildRepo;

// 最新でないモジュールを go.mod で最新バージョンにする。変えたモジュールのパスを返す
async function updateGoMod() {
  const outdated = new Map();
  for (const [path, pending] of latestVersions) {
    const latest = await pending;
    if (latest && latest.same === false) outdated.set(path, latest.label);
  }
  if (!outdated.size || !siteRepo()) return [];
  const files = siteFiles({ repo: siteRepo(), branch: settings.siteBranch }, token);
  const found = await files.getFile('go.mod');
  if (!found) return [];
  const before = decodeBase64(found.base64);
  const after = setGoRequires(before, outdated);
  if (after === before) return [];
  await files.putFile('go.mod', encodeBase64(after), 'Update Hugo modules', found.version);
  return [...outdated.keys()];
}

$('admin-update-rebuild')?.addEventListener('click', async () => {
  if (!window.confirm(t('settings.rebuild_confirm'))) return;
  const button = $('admin-update-rebuild');
  button.disabled = true;
  status('admin-update-status', t('settings.rebuild_starting'));
  try {
    // 古いモジュールがあれば、サイトの go.mod を最新バージョンにしてコミットする。
    // ビルドするリポジトリとブランチが同じなら、このコミットの push でビルドが始まるため、ここでは起動しない
    const updated = await updateGoMod();
    const sameRepo = siteRepo() === settings.buildRepo && settings.siteBranch === settings.buildBranch;
    if (updated.length && sameRepo) {
      status('admin-update-status', t('settings.rebuild_updated', { modules: updated.join(', ') }));
      return;
    }
    const url = await startBuild({ repo: settings.buildRepo, branch: settings.buildBranch }, token, settings.buildWorkflow, { commit: settings.buildCommit });
    const el = $('admin-update-status');
    el.classList.remove('error');
    el.textContent = updated.length
      ? `${t('settings.rebuild_updated_started', { modules: updated.join(', ') })} `
      : `${t('settings.rebuild_started')} `;
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = t('settings.rebuild_log');
      el.append(link);
    }
  } catch (error) {
    status('admin-update-status', t('settings.rebuild_failed', { message: error.message }), true);
  } finally {
    button.disabled = false;
  }
});

// テーマ（data/gh-admin/settings.toml）が定義したバージョンの固定の項目
const controls = [];
const checkbox = () => Object.assign(document.createElement('input'), { type: 'checkbox' });
function fieldLabel(field) {
  const label = field.label;
  if (typeof label === 'string') return label;
  if (label && typeof label === 'object') return label[settings.lang] ?? label.en ?? Object.values(label)[0] ?? field.key;
  return field.key;
}

// type = "moduleversion": go.mod で prefix に一致するモジュールのバージョンを固定するか（自動で更新するか）を切り替える。
// 固定する対象は [[module.imports]] のうち prefix に一致するものと modules に書いたもの。バージョンは source（GitHub の owner/repo）の最新コミット
function renderModuleVersion(field, parent, files) {
  const prefix = field.prefix ?? '';
  const file = field.file ?? 'go.mod';
  const auto = document.createElement('label');
  auto.className = 'field admin-settings-checkbox';
  const autoInput = checkbox();
  auto.append(autoInput, ` ${fieldLabel(field)}`);
  const update = document.createElement('label');
  update.className = 'field admin-settings-checkbox';
  const updateInput = checkbox();
  update.append(updateInput, ` ${t('settings.module_update')}`);
  const note = document.createElement('p');
  note.className = 'admin-note';
  parent.append(auto, note, update);
  let goMod = null;
  const pinned = () => [...readGoRequires(goMod?.text ?? '')].filter(([path]) => path.startsWith(prefix));
  const refresh = () => {
    const versions = [...new Set(pinned().map(([, version]) => version))];
    note.textContent = autoInput.checked
      ? t('settings.module_auto_hint')
      : versions.length ? t('settings.module_pinned_hint', { version: versions.join(', ') }) : t('settings.module_pin_hint');
    update.hidden = autoInput.checked || versions.length === 0;
  };
  autoInput.addEventListener('change', refresh);
  controls.push({
    async connect() {
      const found = await files.getFile(file);
      goMod = found ? { text: decodeBase64(found.base64), version: found.version } : null;
    },
    load() {
      const available = goMod !== null && Boolean(field.source);
      auto.hidden = !available;
      note.hidden = !available;
      autoInput.checked = pinned().length === 0;
      updateInput.checked = false;
      if (available) refresh();
      else update.hidden = true;
    },
    // hugo.toml の変更（テーマの切り替え）を反映したあとの lines から、固定するモジュールを決める
    async save(lines) {
      if (!goMod || !field.source) return false;
      const modules = [...new Set([...(field.modules ?? []), ...readModuleImports(lines).filter((path) => path.startsWith(prefix))])];
      const current = pinned();
      let entries = [];
      if (!autoInput.checked) {
        const version = updateInput.checked || current.length === 0
          ? await latestPseudoVersion(field.source, field.branch)
          : current[0][1];
        entries = modules.map((path) => [path, version]);
      }
      const text = writeGoRequires(goMod.text, prefix, entries);
      if (text === goMod.text) return false;
      await files.putFile(file, encodeBase64(text), 'Update theme version', goMod.version);
      const saved = await files.getFile(file);
      goMod = { text, version: saved?.version };
      return 'file';
    },
  });
}

async function loadPinning() {
  const fields = (settings.fields ?? []).filter((field) => field?.type === 'moduleversion');
  if (!fields.length || !settings.siteRepo || !token) return;
  const files = siteFiles({ repo: settings.siteRepo, branch: settings.siteBranch }, token);
  fields.forEach((field) => renderModuleVersion(field, $('admin-update-pin-fields'), files));
  try {
    for (const control of controls) await control.connect();
    const config = await files.getFile(settings.siteConfigPath);
    const lines = config ? decodeBase64(config.base64).split(/\r?\n/) : [];
    for (const control of controls) control.load(lines);
    $('admin-update-pin').hidden = false;
    $('admin-update-pin-save').addEventListener('click', async () => {
      const button = $('admin-update-pin-save');
      button.disabled = true;
      status('admin-update-pin-status', t('settings.saving'));
      try {
        let changed = false;
        for (const control of controls) if (await control.save(lines)) changed = true;
        for (const control of controls) control.load(lines);
        status('admin-update-pin-status', changed ? t('settings.pin_saved') : t('settings.pin_unchanged'));
      } catch (error) {
        status('admin-update-pin-status', error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    $('admin-update-pin').hidden = false;
    status('admin-update-pin-status', error.message, true);
  }
}

loadVersions();
loadPinning();
if (!token) {
  $('admin-update-login').hidden = false;
  if ($('admin-update-rebuild')) $('admin-update-rebuild').disabled = true;
}
