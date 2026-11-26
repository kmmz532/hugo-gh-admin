import { config } from './config.js';
import { checkRepoPush, fetchLogin, saveSession, repo } from './backend.js';
import { t } from './i18n.js';

const form = document.getElementById('login-form');
const tokenInput = document.getElementById('token');
const status = document.getElementById('login-status');
const oauthButton = document.getElementById('oauth-login');
const oauthStatus = document.getElementById('oauth-status');
const OAUTH_KEY = 'gh_admin_oauth';

// 同一 origin のパスだけ戻り先として許可する
function returnPath(search = location.search) {
  const ret = new URLSearchParams(search).get('return') ?? config.rootURL;
  // ブラウザは /\example.com を //example.com と同じに扱うので、文字列ではなく URL として origin を比べる
  if (!ret.startsWith('/')) return config.rootURL;
  try {
    const url = new URL(ret, location.origin);
    return url.origin === location.origin ? url.pathname + url.search + url.hash : config.rootURL;
  } catch {
    return config.rootURL;
  }
}

function showError(el, message) {
  el.textContent = message;
  el.classList.add('error');
}

// トークンを確認して保存し、元のページに戻る
async function signIn(token, el, ret) {
  if (!(await checkRepoPush(token))) {
    showError(el, t('login.no_push', { repo }));
    return;
  }
  const login = await fetchLogin(token);
  saveSession(token, login);
  location.replace(ret);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = t('login.checking');
  status.classList.remove('error');
  try {
    await signIn(tokenInput.value.trim(), status, returnPath());
  } catch (error) {
    showError(status, error.message);
  } finally {
    button.disabled = false;
  }
});

const base64Url = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// GitHub の OAuth。oauthRelayURL を設定したときは、共用の中継ページ（OAuth App に登録したコールバック URL）を経由してこのページに戻る。
// 未設定なら、このページ自体をコールバック URL にする（サイトが自分の OAuth App を用意した場合）
oauthButton?.addEventListener('click', () => {
  const state = crypto.randomUUID();
  const here = location.origin + location.pathname;
  sessionStorage.setItem(OAUTH_KEY, JSON.stringify({ state, ret: returnPath() }));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.oauthClientID);
  url.searchParams.set('scope', 'repo');
  url.searchParams.set('redirect_uri', config.oauthRelayURL || here);
  url.searchParams.set('state', config.oauthRelayURL ? base64Url(JSON.stringify({ r: here, s: state })) : state);
  location.assign(url);
});

// GitHub（または中継ページ）から ?code=...&state=... で戻ってきたとき
async function completeOAuth() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!oauthButton || (!code && !error)) return;
  history.replaceState(null, '', location.pathname);
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(OAUTH_KEY) ?? 'null'); } catch {}
  sessionStorage.removeItem(OAUTH_KEY);
  if (error) {
    showError(oauthStatus, params.get('error_description') ?? error);
    return;
  }
  if (!saved || params.get('state') !== saved.state) {
    showError(oauthStatus, t('login.oauth_state'));
    return;
  }
  oauthButton.disabled = true;
  oauthStatus.textContent = t('login.checking');
  try {
    const res = await fetch(config.oauthTokenURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(t('login.oauth_failed', { message: data.error ?? res.status }));
    await signIn(data.access_token, oauthStatus, saved.ret);
  } catch (e) {
    showError(oauthStatus, e.message);
  } finally {
    oauthButton.disabled = false;
  }
}

completeOAuth();
