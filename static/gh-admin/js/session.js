// ログインの保存先（キー）と、保存したログインの確認・削除。設定（config.js）を読まないので、
// 管理画面の部品を組み込んでいないページ（float.js）からも使える。
import { getItem, removeItem } from './storage.js';

export const TOKEN_KEY = 'blog_token';
export const LOGIN_KEY = 'blog_login';
// tokenProvider（サイトが用意する受け取り口）から受け取ったトークン。タブを閉じると消える
export const SESSION_KEY = 'gh_session_token';

export function getSessionToken() {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token) {
  try {
    sessionStorage.setItem(SESSION_KEY, token);
  } catch {
    // 保存できなければ、次の読み込みで受け取り直す
  }
}

// トークンを保存しているか（どちらの保存先でもよい）
export const hasStoredToken = () => Boolean(getSessionToken() || getItem(TOKEN_KEY));

export function clearStoredSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 消せなくても致命的ではない
  }
  removeItem(TOKEN_KEY);
  removeItem(LOGIN_KEY);
}
