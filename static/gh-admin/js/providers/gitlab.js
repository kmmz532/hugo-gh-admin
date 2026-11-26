// GitLab のアダプタ（gitlab.com とセルフホスト）。関数の名前と戻り値は providers/github.js と揃える。
// ファイルの版（sha）には、そのファイルを最後に変更したコミットの ID（last_commit_id）を使う。
import { config } from '../config.js';
import { t } from '../i18n.js';
import {
  repo, branch, request, IMAGE_PATH_RE, toPublicPath, toRepoPath, postPath, fromBase64,
} from '../core.js';

// セルフホストのときは params.ghAdmin.gitlabURL にインスタンスの URL を書く
const GITLAB_URL = (config.gitlabURL || 'https://gitlab.com').replace(/\/+$/, '');
const API_BASE = `${GITLAB_URL}/api/v4`;
// 書き込み先と同じファイルが既にある・他で更新されたときに GitLab が返す 400 の文言
const CONFLICT_MESSAGE_RE = /already exists|has changed|have been changed|does not exist|doesn't exist/i;
const isConflict = (status, message) => status === 400 && CONFLICT_MESSAGE_RE.test(message);

// 作者（GitLab のユーザー名）の形
export const AUTHOR_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}$/;

// repo はプロジェクトのフルパス（group/subgroup/project）
const projectUrl = (target = repo) => `/projects/${encodeURIComponent(target)}`;
const fileUrl = (path, target = repo) => `${projectUrl(target)}/repository/files/${encodeURIComponent(path)}`;
const api = (endpoint, options = {}) => request(`${API_BASE}${endpoint}`, { ...options, isConflict });

// 1 コミットで複数のファイルを変更する。新しいコミットを返す
const commitTo = (target, targetBranch, message, actions, options = {}) =>
  api(`${projectUrl(target)}/repository/commits`, {
    ...options,
    method: 'POST',
    body: { branch: targetBranch, commit_message: message, actions },
  });
const commit = async (message, actions) => (await commitTo(repo, branch, message, actions)).id;

// 存在しなければ null
export async function getPost(slug) {
  const json = await api(`${fileUrl(postPath(slug))}?ref=${encodeURIComponent(branch)}`);
  if (!json) return null;
  return { sha: json.last_commit_id, text: fromBase64(json.content) };
}

export const COMMITS_PER_PAGE = 30;

// 記事ファイルのコミット履歴を新しい順に返す。page は 1 始まり。
// 名前の変更（slug の変更）はたどらない。履歴が無ければ空の配列
export async function listPostCommits(slug, { page = 1 } = {}) {
  const path = encodeURIComponent(postPath(slug));
  const json = await api(`${projectUrl()}/repository/commits?path=${path}&ref_name=${encodeURIComponent(branch)}&per_page=${COMMITS_PER_PAGE}&page=${page}`);
  return (json ?? []).map((item) => ({
    sha: item.id,
    message: item.message,
    date: item.authored_date,
    author: item.author_name,
    url: item.web_url,
  }));
}

// sha を省略すると新規作成。既存ファイルがあれば ConflictError。新しい sha を返す
export async function savePost(slug, text, sha) {
  const action = sha
    ? { action: 'update', file_path: postPath(slug), content: text, last_commit_id: sha }
    : { action: 'create', file_path: postPath(slug), content: text };
  return commit(`post: ${slug}`, [action]);
}

export async function deletePost(slug, sha) {
  await commit(`delete: ${slug}`, [{ action: 'delete', file_path: postPath(slug), ...(sha ? { last_commit_id: sha } : {}) }]);
}

// 複数の記事を 1 コミットにまとめる。changes は { slug: text | null }（null は削除）。
// bases（{ slug: sha }）を渡すと、読み込んだ後に他で更新された記事があれば ConflictError。失敗時は何も変わらない
export async function commitChanges(changes, message, bases = {}) {
  const actions = Object.entries(changes).map(([slug, text]) => ({
    action: text === null ? 'delete' : 'update',
    file_path: postPath(slug),
    ...(text === null ? {} : { content: text }),
    ...(bases[slug] ? { last_commit_id: bases[slug] } : {}),
  }));
  return commit(message, actions);
}

// base64 は呼び出し側で作る（バイナリを扱うため）。既存パスは ConflictError
export async function saveImage(path, base64) {
  if (!IMAGE_PATH_RE.test(path)) throw new Error(t('error.image_path'));
  await commit(`image: ${path}`, [{ action: 'create', file_path: path, content: base64, encoding: 'base64' }]);
}

// ツリーを 100 件ずつたどって全件を返す
async function listTree(path) {
  const items = [];
  for (let page = 1; ; page += 1) {
    const result = await api(
      `${projectUrl()}/repository/tree?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(branch)}&recursive=true&per_page=100&page=${page}`,
      { withHeaders: true },
    );
    if (!result) return items;
    items.push(...result.json);
    if (!result.headers.get('X-Next-Page')) return items;
  }
}

// 保存済みの画像を新しい年から順に返す。publicPath は記事に書く /images/<yyyy>/<name>。
// size は GitLab のツリーから取れないため null
export async function listImages() {
  const entries = await listTree(config.imagesDir);
  return entries
    .filter((entry) => entry.type === 'blob' && IMAGE_PATH_RE.test(entry.path))
    .map((entry) => ({
      path: entry.path,
      publicPath: toPublicPath(entry.path),
      sha: null,
      size: null,
    }))
    .sort((a, b) => (a.publicPath < b.publicPath ? 1 : -1));
}

export async function deleteImage(path) {
  if (!IMAGE_PATH_RE.test(path)) throw new Error(t('error.image_path'));
  await commit(`delete image: ${path}`, [{ action: 'delete', file_path: path }]);
}

// 公開前の画像を見るための URL（記事のリポジトリは public）。/images/... の記事内の書き方から作る
export const rawImageUrl = (publicPath) =>
  `${GITLAB_URL}/${repo}/-/raw/${encodeURIComponent(branch)}/${toRepoPath(publicPath)}`;

// ログイン時に使う。書き込み権限の確認はここで行う（保護ブランチの設定も含めて GitLab が判定した値）
export async function checkRepoPush(token) {
  const json = await api(`${projectUrl()}/repository/branches/${encodeURIComponent(branch)}`, { token });
  return json?.can_push === true;
}

export async function fetchLogin(token) {
  const json = await api('/user', { token });
  if (!json) throw new Error(t('error.user_info'));
  return json.username;
}

// サイト設定（/admin/settings/）が使う、サイト本体リポジトリの読み書き。
// getFile は { base64, version }（無ければ null）、putFile は短いコミット ID を返す。
// 書き込みを拒否されたときは writeDenied を付けたエラーを投げる
export function siteFiles(target, token) {
  const guard = async (run) => {
    try {
      return await run();
    } catch (error) {
      if (error.status === 403) {
        throw Object.assign(new Error(t('settings.repo_write_denied', { repo: target.repo })), { writeDenied: true });
      }
      throw error;
    }
  };
  return {
    canPush: () => guard(async () => {
      const json = await api(`${projectUrl(target.repo)}/repository/branches/${encodeURIComponent(target.branch)}`, { token, session: false });
      return json?.can_push === true;
    }),
    getFile: (path) => guard(async () => {
      const json = await api(`${fileUrl(path, target.repo)}?ref=${encodeURIComponent(target.branch)}`, { token, session: false });
      return json && { base64: json.content, version: json.last_commit_id };
    }),
    putFile: (path, base64, message, version) => guard(async () => {
      const action = { action: version ? 'update' : 'create', file_path: path, content: base64, encoding: 'base64', ...(version ? { last_commit_id: version } : {}) };
      const json = await commitTo(target.repo, target.branch, message, [action], { token, session: false });
      return json.short_id ?? '';
    }),
  };
}
