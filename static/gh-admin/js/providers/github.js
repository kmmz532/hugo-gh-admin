// GitHub のアダプタ。関数の名前と戻り値は providers/gitlab.js と揃える。ファイルの版（sha）は blob の SHA
import { config } from '../config.js';
import { t } from '../i18n.js';
import {
  repo, branch, request, IMAGE_PATH_RE, toPublicPath, toRepoPath, postPath, toBase64, fromBase64,
} from '../core.js';

const API_ORIGIN = 'https://api.github.com';
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };

// 作者（GitHub のユーザー名）の形
export const AUTHOR_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const api = (endpoint, options = {}) => request(`${API_ORIGIN}${endpoint}`, { ...options, headers: HEADERS });
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
const contentsUrl = (path, target = repo) => `/repos/${target}/contents/${encodePath(path)}`;

// 存在しなければ null
export async function getPost(slug) {
  const json = await api(`${contentsUrl(postPath(slug))}?ref=${encodeURIComponent(branch)}`);
  if (!json) return null;
  return { sha: json.sha, text: fromBase64(json.content) };
}

export const COMMITS_PER_PAGE = 30;

// 記事ファイルのコミット履歴を新しい順に返す。page は 1 始まり。
// 名前の変更（slug の変更）はたどらない。履歴が無ければ空の配列
export async function listPostCommits(slug, { page = 1 } = {}) {
  const path = encodeURIComponent(postPath(slug));
  const json = await api(`/repos/${repo}/commits?path=${path}&sha=${encodeURIComponent(branch)}&per_page=${COMMITS_PER_PAGE}&page=${page}`);
  return (json ?? []).map((item) => ({
    sha: item.sha,
    message: item.commit.message,
    date: item.commit.author.date,
    author: item.author?.login ?? item.commit.author.name,
    url: item.html_url,
  }));
}

// sha を省略すると新規作成。既存ファイルがあれば ConflictError。新しい sha を返す
export async function savePost(slug, text, sha) {
  const json = await api(contentsUrl(postPath(slug)), {
    method: 'PUT',
    body: { message: `post: ${slug}`, content: toBase64(text), branch, ...(sha ? { sha } : {}) },
  });
  return json.content.sha;
}

export async function deletePost(slug, sha) {
  await api(contentsUrl(postPath(slug)), {
    method: 'DELETE',
    body: { message: `delete: ${slug}`, sha, branch },
  });
}

// 複数の記事を 1 コミットにまとめる。changes は { slug: text | null }（null は削除）。
// 参照（ブランチ）が他で進んでいたら ConflictError。強制更新はしないので、失敗時は何も変わらない。
// bases は GitLab との互換のために受け取るだけで、使わない（ブランチの先頭で競合を判定する）
export async function commitChanges(changes, message) {
  const ref = await api(`/repos/${repo}/git/ref/heads/${branch}`);
  const headSha = ref.object.sha;
  const head = await api(`/repos/${repo}/git/commits/${headSha}`);

  const entries = [];
  for (const [slug, text] of Object.entries(changes)) {
    const path = postPath(slug);
    if (text === null) {
      entries.push({ path, mode: '100644', type: 'blob', sha: null });
    } else {
      const blob = await api(`/repos/${repo}/git/blobs`, { method: 'POST', body: { content: text, encoding: 'utf-8' } });
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }
  const tree = await api(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: { base_tree: head.tree.sha, tree: entries },
  });
  const commit = await api(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: { message, tree: tree.sha, parents: [headSha] },
  });
  await api(`/repos/${repo}/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha } });
  return commit.sha;
}

// base64 は呼び出し側で作る（バイナリを扱うため）。既存パスは ConflictError
export async function saveImage(path, base64) {
  if (!IMAGE_PATH_RE.test(path)) throw new Error(t('error.image_path'));
  await api(contentsUrl(path), {
    method: 'PUT',
    body: { message: `image: ${path}`, content: base64, branch },
  });
}

// 保存済みの画像を新しい年から順に返す。publicPath は記事に書く /images/<yyyy>/<name>。
// 1 つのフォルダは 1000 件まで。取れない年があっても他の年は返す
export async function listImages() {
  const ref = `?ref=${encodeURIComponent(branch)}`;
  const years = (await api(`${contentsUrl(config.imagesDir)}${ref}`)) ?? [];
  const dirs = years.filter((entry) => entry.type === 'dir' && /^\d{4}$/.test(entry.name));
  const lists = await Promise.all(dirs.map((dir) => api(`${contentsUrl(dir.path)}${ref}`)));
  return lists
    .flatMap((list) => list ?? [])
    .filter((entry) => entry.type === 'file' && IMAGE_PATH_RE.test(entry.path))
    .map((entry) => ({
      path: entry.path,
      publicPath: toPublicPath(entry.path),
      sha: entry.sha,
      size: entry.size,
    }))
    .sort((a, b) => (a.publicPath < b.publicPath ? 1 : -1));
}

export async function deleteImage(path, sha) {
  if (!IMAGE_PATH_RE.test(path)) throw new Error(t('error.image_path'));
  await api(contentsUrl(path), {
    method: 'DELETE',
    body: { message: `delete image: ${path}`, sha, branch },
  });
}

// 公開前の画像を見るための URL（記事のリポジトリは public）。/images/... の記事内の書き方から作る
export const rawImageUrl = (publicPath) => `https://raw.githubusercontent.com/${repo}/${branch}/${toRepoPath(publicPath)}`;

// ログイン時に使う。書き込み権限の確認はここで行う
export async function checkRepoPush(token) {
  const json = await api(`/repos/${repo}`, { token });
  return json?.permissions?.push === true;
}

export async function fetchLogin(token) {
  const json = await api('/user', { token });
  if (!json) throw new Error(t('error.user_info'));
  return json.login;
}

// サイト設定（/admin/settings/）が使う、サイト本体リポジトリの読み書き。
// getFile は { base64, version }（無ければ null）、putFile は短いコミット ID を返す。
// 書き込みを拒否されたときは writeDenied を付けたエラーを投げる
export function siteFiles(target, token) {
  const call = async (endpoint, options = {}) => {
    try {
      return await api(endpoint, { ...options, token, session: false });
    } catch (error) {
      if (error.status === 403 && /Resource not accessible by personal access token/i.test(error.detail)) {
        throw Object.assign(new Error(t('settings.repo_write_denied', { repo: target.repo })), { writeDenied: true });
      }
      throw error;
    }
  };
  return {
    async canPush() {
      const json = await call(`/repos/${target.repo}`);
      return json?.permissions?.push === true;
    },
    async getFile(path) {
      const json = await call(`${contentsUrl(path, target.repo)}?ref=${encodeURIComponent(target.branch)}`);
      return json && { base64: json.content, version: json.sha };
    },
    async putFile(path, base64, message, version) {
      const json = await call(contentsUrl(path, target.repo), {
        method: 'PUT',
        body: { message, content: base64, branch: target.branch, ...(version ? { sha: version } : {}) },
      });
      return json.commit?.sha?.slice(0, 7) ?? '';
    },
  };
}

// サイトを再ビルドする。workflow はワークフローのファイル名（例: deploy.yml）で、手動実行する。
// commit が true なら、中身が空のコミットを積む（Cloudflare Pages など、push でビルドする連携向け）。返り値はビルドの状況を見る URL
export async function startBuild(target, token, workflow, { commit = false } = {}) {
  if (commit) {
    const base = `/repos/${target.repo}/git`;
    const options = { token, session: false };
    const head = await api(`${base}/ref/heads/${encodeURIComponent(target.branch)}`, options);
    const parent = await api(`${base}/commits/${head.object.sha}`, options);
    const created = await api(`${base}/commits`, { ...options, method: 'POST', body: { message: 'Rebuild the site', tree: parent.tree.sha, parents: [head.object.sha] } });
    await api(`${base}/refs/heads/${encodeURIComponent(target.branch)}`, { ...options, method: 'PATCH', body: { sha: created.sha } });
    return `https://github.com/${target.repo}/commit/${created.sha}`;
  }
  await api(`/repos/${target.repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: 'POST', body: { ref: target.branch }, token, session: false,
  });
  return `https://github.com/${target.repo}/actions/workflows/${encodeURIComponent(workflow)}`;
}
