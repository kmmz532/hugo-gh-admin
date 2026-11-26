// slug の自動生成・検証・表示。画面の状態（state）は引数で受け取る。editor.js は import しない
import { isValidSlug, isValidPageSlug } from './backend.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

// 自動の slug: 通常記事は YYYY-MM-DD-NN、外部記事は ext-YYYY-MM-DD-NN（NN は 00〜99 の乱数）
const AUTO_SLUG_RE = /^(?:ext-)?\d{4}-\d{2}-\d{2}-(\d{2})$/;

export function createSlug({ state }) {
  // slug 欄の直下のエラー。空文字で消す
  function setSlugError(message) {
    $('f-slug').setAttribute('aria-invalid', String(Boolean(message)));
    $('f-slug-error').textContent = message;
    $('f-slug-error').hidden = !message;
  }

  function randomNumber() {
    return String(Math.floor(Math.random() * 100)).padStart(2, '0');
  }

  function autoSlugFor(fields) {
    state.autoNumber ??= randomNumber();
    return `${fields.kind === 'external' ? 'ext-' : ''}${fields.date.slice(0, 10)}-${state.autoNumber}`;
  }

  function updateSlugAuto() {
    $('slug-auto').hidden = state.originalSlug !== null || !state.slugAuto;
  }

  // 自動のままなら、投稿日時か記事の種類が変わったときに slug を作り直す（保存はしない）
  function syncAutoSlug() {
    if (state.originalSlug !== null || !state.slugAuto || state.kind === 'page') return;
    const date = $('f-date').value;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(date)) return;
    $('f-slug').value = autoSlugFor({ kind: state.kind, date });
    setSlugError('');
  }

  // 手で書き換えたら自動を止める。空にしたら自動に戻し、すぐ作り直す
  function attach() {
    $('f-slug').addEventListener('input', () => {
      // 固定ページの slug は手入力のみ（自動にしない）
      if (state.originalSlug === null && state.kind !== 'page') {
        state.slugAuto = $('f-slug').value === '';
        // 空に戻したら番号も振り直す
        if (state.slugAuto) state.autoNumber = null;
      }
      syncAutoSlug();
      updateSlugAuto();
      const slug = $('f-slug').value;
      if (slug && !isValidSlug(slug)) setSlugError(t('slug.format_invalid'));
      else if (slug && state.kind === 'page' && !isValidPageSlug(slug)) setSlugError(t('editor.slug_reserved'));
      else setSlugError('');
    });
  }

  return { AUTO_SLUG_RE, randomNumber, autoSlugFor, setSlugError, updateSlugAuto, syncAutoSlug, attach };
}
