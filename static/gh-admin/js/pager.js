// 一覧のページネーション（前へ・ページ番号・次へ）。container の中身を作り直す。
// ページ番号は先頭・末尾と、今のページの前後だけを出し、間は「…」にする
import { t } from './i18n.js';

export function renderPager(container, { page, pages, onChange }) {
  container.hidden = pages <= 1;
  if (pages <= 1) {
    container.replaceChildren();
    return;
  }
  const button = (text, target, label, current = false) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'btn pager-button';
    element.textContent = text;
    element.setAttribute('aria-label', label);
    if (current) element.setAttribute('aria-current', 'page');
    element.disabled = current || target < 1 || target > pages;
    element.addEventListener('click', () => onChange(target));
    return element;
  };
  const shown = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const items = [button('‹', page - 1, t('common.page_prev'))];
  shown.forEach((n, index) => {
    if (index && n - shown[index - 1] > 1) {
      const gap = document.createElement('span');
      gap.className = 'pager-gap';
      gap.textContent = '…';
      items.push(gap);
    }
    items.push(button(String(n), n, t('common.page_label', { page: n }), n === page));
  });
  items.push(button('›', page + 1, t('common.page_next')));
  container.replaceChildren(...items);
}
