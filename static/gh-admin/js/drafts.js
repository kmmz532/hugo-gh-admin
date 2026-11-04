// 下書きはこの端末の localStorage にだけ保存する（公開リポジトリに未公開記事を置かないため）。
import { config } from './config.js';
import { getItem, setItem, removeItem, keys } from './storage.js';
import { setSaveState, showNotice } from './notice.js';
import { t, lang } from './i18n.js';

const PREFIX = 'blog_draft:';
// slug は英小文字・数字・ハイフンのみなので、'_' で始めれば記事の slug と衝突しない
const NEW_SLUG = '_new';

export const draftKey = (slug) => `${PREFIX}${slug ?? NEW_SLUG}`;

export const hasDraft = (key) => getItem(key) !== null;

// 壊れた下書きは null
export function readDraft(key) {
  try {
    return JSON.parse(getItem(key));
  } catch {
    return null;
  }
}

export const writeDraft = (key, payload) => setItem(key, JSON.stringify(payload));

export const removeDraft = (key) => removeItem(key);

export function renderDrafts(list) {
  const items = keys()
    .filter((key) => key.startsWith(PREFIX))
    .flatMap((key) => {
      const draft = readDraft(key);
      return draft ? [{ slug: key.slice(PREFIX.length), draft }] : [];
    });

  list.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'card-meta';
    empty.textContent = t('drafts.empty');
    list.append(empty);
    return;
  }
  for (const { slug, draft } of items) {
    const isNew = slug === NEW_SLUG;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = isNew ? config.editURL : `${config.editURL}?slug=${encodeURIComponent(slug)}`;
    link.textContent = draft.title || t('common.untitled');
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    meta.textContent = ` ${t('drafts.meta', { label: isNew ? t('drafts.new_label') : slug, time: new Date(draft.savedAt).toLocaleString(lang) })}`;
    item.append(link, meta);
    list.append(item);
  }
}

const $ = (id) => document.getElementById(id);

// 下書きの画面側の処理（保存・お知らせ・復元と破棄）。画面の状態と画面の関数は引数で受け取る。editor.js は import しない
export function createDrafts({ state, readForm, writeForm, refreshPreview, updateChrome }) {
  // ---- 下書き ----

  function saveDraft() {
    // 復元か破棄を選ぶまでは、残っている下書きを上書きしない
    if (state.pendingDraft) return;
    const payload = {
      ...readForm(),
      sha: state.sha,
      aliases: state.aliases,
      extra: state.extra,
      savedAt: new Date().toISOString(),
    };
    if (!writeDraft(draftKey(state.originalSlug), payload)) {
      showNotice('error', t('drafts.save_error'));
    } else {
      const time = new Date().toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
      setSaveState('draft', t('drafts.saved_at', { time }));
    }
    renderDrafts($('drafts'));
  }

  // 下書きの案内は、上のお知らせ欄ではなく「下書き」の折りたたみの中に出す（本文の邪魔にならないように）。
  // 選ぶまでは折りたたみを開いたままにし、見出しにも「復元待ち」と出して忘れないようにする
  function showDraftNotice(key, draft) {
    state.pendingDraft = { key, draft };
    const time = new Date(draft.savedAt).toLocaleString(lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    $('draft-pending-text').textContent = t('drafts.pending_text', { time });
    $('draft-pending').hidden = false;
    $('drafts-summary').textContent = t('drafts.summary_pending');
    $('drafts-details').classList.add('has-pending');
    $('drafts-details').open = true;
    // 記事設定が本文の下に回る狭い画面でも気づけるように、編集バーの保存状態にも短く出す
    setSaveState('draft', t('drafts.unrestored'));
  }

  function closeDraftNotice() {
    state.pendingDraft = null;
    $('draft-pending').hidden = true;
    $('drafts-summary').textContent = t('drafts.summary');
    $('drafts-details').classList.remove('has-pending');
  }

  $('draft-restore').addEventListener('click', () => restoreDraft());
  $('draft-drop').addEventListener('click', () => discardDraft());

  function restoreDraft() {
    if (!state.pendingDraft) return;
    const { draft } = state.pendingDraft;
    closeDraftNotice();
    writeForm(draft);
    state.categoryPicked = true;
    state.sha = draft.sha ?? null;
    state.aliases = draft.aliases ?? [];
    state.extra = draft.extra ?? [];
    state.dirty = true;
    updateChrome();
    refreshPreview();
    showNotice('info', t('drafts.restored'));
  }

  function discardDraft() {
    if (!state.pendingDraft) return;
    removeDraft(state.pendingDraft.key);
    closeDraftNotice();
    renderDrafts($('drafts'));
    showNotice('info', t('drafts.discarded'));
  }


  return { saveDraft, showDraftNotice, closeDraftNotice };
}
