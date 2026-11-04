// 公開・slug 変更・削除。画面の状態と部品は引数で受け取る。editor.js は import しない
import { config } from './config.js';
import { savePost, deletePost, ConflictError } from './github.js';
import { buildArticle, buildExternal } from './frontmatter.js';
import { draftKey, removeDraft, renderDrafts } from './drafts.js';
import { setSaveState, showNotice } from './notice.js';
import { recordSave, recordDelete, postPath } from './pending.js';
import { nowJst } from './time.js';
import { setItem } from './storage.js';
import { t, lang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const AUTO_SLUG_TRIES = 5;

function errorMessage(error, creating) {
  if (error instanceof ConflictError) {
    return creating
      ? t('save.conflict_new')
      : t('save.conflict_update');
  }
  return error.message;
}

export function createSave({ state, readForm, validate, slugs, drafts, cancelDraft, updateChrome }) {
  // ---- 保存・削除 ----

  function serialize(fields, aliases) {
    return fields.kind === 'external'
      ? buildExternal(fields, state.extra)
      : buildArticle(fields, aliases, state.extra);
  }

  // slug 変更: 新 slug を作ってから旧ファイルを消す。旧ファイルの削除に失敗したら警告を返す
  async function renameSlug(fields) {
    const oldSlug = state.originalSlug;
    const oldSha = state.sha;
    // 外部記事は本文がないので aliases も付けない
    const aliases = fields.kind === 'external' ? [] : [...new Set([...state.aliases, postPath(oldSlug, fields.date)])];

    // sha を付けない。同名があれば ConflictError で中止される
    const sha = await savePost(fields.slug, serialize(fields, aliases));
    state.aliases = aliases;
    state.sha = sha;

    try {
      await deletePost(oldSlug, oldSha);
      return null;
    } catch (error) {
      return t('save.old_delete_failed', { slug: oldSlug, message: error.message });
    }
  }

  // 新規の保存。自動の slug が既存と重なったら番号を振り直して再試行する。手入力の slug は付け直さない
  async function saveNewPost(fields, auto) {
    const attempts = auto ? AUTO_SLUG_TRIES : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (auto) {
        if (attempt > 1) state.autoNumber = slugs.randomNumber();
        fields.slug = slugs.autoSlugFor(fields);
      }
      try {
        return { slug: fields.slug, sha: await savePost(fields.slug, serialize(fields, state.aliases)) };
      } catch (error) {
        if (!auto || !(error instanceof ConflictError)) throw error;
      }
    }
    throw new Error(t('save.slug_retry_failed', { tries: AUTO_SLUG_TRIES }));
  }

  async function publish(event) {
    event.preventDefault();
    const fields = readForm();
    const invalid = validate(fields);
    if (invalid) {
      if (invalid.field === 'f-slug') slugs.setSlugError(invalid.message);
      showNotice('error', t('save.invalid_input', { message: invalid.message }));
      $(invalid.field).focus();
      return;
    }

    const creating = state.originalSlug === null;
    // 既存記事の更新は更新日を今にする（新規公開では付けない）
    if (!creating) fields.lastmod = `${nowJst()}:00+09:00`;
    const auto = creating && state.slugAuto;
    const slugChanged = !creating && fields.slug !== state.originalSlug;
    const oldKey = draftKey(state.originalSlug);
    const oldSlug = state.originalSlug;

    $('save').disabled = true;
    cancelDraft();
    setSaveState('publishing', t('save.publishing'));
    try {
      let warning = null;
      if (slugChanged) {
        warning = await renameSlug(fields);
      } else if (creating) {
        const saved = await saveNewPost(fields, auto);
        state.sha = saved.sha;
        $('f-slug').value = saved.slug;
      } else {
        state.sha = await savePost(fields.slug, serialize(fields, state.aliases), state.sha);
      }

      state.originalSlug = fields.slug;
      removeDraft(oldKey);
      drafts.closeDraftNotice();
      // 反映待ちの控え。slug を変えた場合は旧 slug を削除の控えにする（旧ファイルの削除に失敗していなければ）
      if (config.authorField && fields.kind !== 'external') setItem('gh_admin_author', fields.author);
      recordSave(fields.slug, {
        fields,
        isNew: creating || slugChanged,
        oldSlug: slugChanged ? oldSlug : null,
      });
      if (slugChanged && !warning) recordDelete(oldSlug);
      state.dirty = false;
      history.replaceState(null, '', `${config.editURL}?slug=${encodeURIComponent(fields.slug)}`);
      updateChrome();
      renderDrafts($('drafts'));

      setSaveState('published', t('save.published_at', { time: new Date().toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) }));
      if (warning) showNotice('error', warning);
      else showNotice('success', t('save.success'));
    } catch (error) {
      showNotice('error', errorMessage(error, creating || slugChanged));
      setSaveState('unsaved', t('save.unsaved'));
    } finally {
      $('save').disabled = false;
    }
  }

  async function removePost() {
    const slug = state.originalSlug;
    if (slug === null) return;
    const typed = prompt(t('save.delete_prompt', { slug }));
    if (typed === null) return;
    if (typed !== slug) {
      showNotice('error', t('save.slug_mismatch'));
      return;
    }

    $('delete').disabled = true;
    cancelDraft();
    try {
      await deletePost(slug, state.sha);
      recordDelete(slug);
      removeDraft(draftKey(slug));
      state.dirty = false;
      location.assign(config.rootURL);
    } catch (error) {
      showNotice('error', errorMessage(error, false));
      $('delete').disabled = false;
    }
  }


  return { publish, removePost };
}
