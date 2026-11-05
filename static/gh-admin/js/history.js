// 編集画面の「履歴」。記事ファイルのコミット履歴を新しい順に出す。初めて開いたときに読み込み、保存のあとは開いていれば読み直す。
import { listPostCommits, COMMITS_PER_PAGE } from './github.js';
import { t, lang } from './i18n.js';

const $ = (id) => document.getElementById(id);

// 日時は日本時間で出す（time.js と同じ扱い）
const DATE_FORMAT = new Intl.DateTimeFormat(lang, {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// 先頭のページが空だったときの取り直しの回数と間隔（ミリ秒）
const EMPTY_RETRIES = 3;
const EMPTY_RETRY_MS = 2000;

// 1 件分の行。文字列はすべて textContent で入れる
function commitRow(commit) {
  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'history-meta';
  meta.textContent = `${DATE_FORMAT.format(new Date(commit.date))} ${commit.author}`;
  const message = document.createElement('div');
  message.className = 'history-message';
  message.textContent = commit.message.split('\n')[0];
  const link = document.createElement('a');
  link.href = commit.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = t('history.diff');
  li.append(meta, message, link);
  return li;
}

export function createHistory({ state }) {
  const details = $('history-details');
  const list = $('history-list');
  const status = $('history-status');
  const more = $('history-more');
  // 読み込み済みのページ数（新しい順に積む）。0 なら未読み込み
  let page = 0;
  // 読み込みを始めるたびに増やす。記事が変わった後に届いた古い応答を捨てるため
  let request = 0;
  let loading = false;

  const setStatus = (text) => {
    status.textContent = text;
    status.hidden = !text;
  };

  function reset() {
    request++;
    page = 0;
    loading = false;
    list.replaceChildren();
    more.hidden = true;
    setStatus('');
  }

  async function loadPage(n) {
    // 新規記事（まだファイルが無い）は GitHub に問い合わせない
    if (state.originalSlug === null) {
      setStatus(t('history.unsaved'));
      return;
    }
    const id = ++request;
    loading = true;
    more.disabled = true;
    setStatus(t('common.loading'));
    try {
      let commits = await listPostCommits(state.originalSlug, { page: n });
      // 保存の直後は GitHub の一覧に反映されるまで遅れることがあるため、先頭のページが空なら少し待って取り直す
      for (let retry = 0; n === 1 && commits.length === 0 && retry < EMPTY_RETRIES; retry++) {
        await new Promise((resolve) => setTimeout(resolve, EMPTY_RETRY_MS));
        if (id !== request) return;
        commits = await listPostCommits(state.originalSlug, { page: n });
      }
      if (id !== request) return;
      list.append(...commits.map(commitRow));
      page = n;
      // 件数が 1 ページ分に満たなければ、これ以上は無い
      more.hidden = commits.length < COMMITS_PER_PAGE;
      setStatus(n === 1 && commits.length === 0 ? t('history.empty') : '');
    } catch (error) {
      if (id !== request) return;
      setStatus(error.message);
      more.hidden = false;
    } finally {
      if (id === request) {
        loading = false;
        more.disabled = false;
      }
    }
  }

  // 開いたとき、または保存のあとに、先頭のページから読む
  function show() {
    reset();
    if (details.open) loadPage(1);
  }

  function attach() {
    details.addEventListener('toggle', () => {
      if (details.open && page === 0 && !loading) loadPage(1);
    });
    more.addEventListener('click', () => loadPage(page + 1));
  }

  return { attach, reload: show };
}
