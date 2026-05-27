// OAuth 2.0 / OpenID Connect implicit flow com Google — response_type=id_token.
// Sem popup: usamos redirect completo. Não há access_token, só validamos identidade.

const STATE_KEY = 'google_oauth_state';
const NONCE_KEY = 'google_oauth_nonce';
const RETURN_KEY = 'google_oauth_return';

function randomString(len = 32): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function startGoogleLogin(returnTo: string = '/onboarding/api-keys') {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID não configurado no .env do frontend.');
  }

  const state = randomString();
  const nonce = randomString();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(NONCE_KEY, nonce);
  sessionStorage.setItem(RETURN_KEY, returnTo);

  const redirectUri = `${window.location.origin}/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'id_token',
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    state,
    nonce,
    prompt: 'select_account',
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface CallbackResult {
  idToken: string;
  returnTo: string;
}

export function consumeGoogleCallback(): CallbackResult {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const params = new URLSearchParams(hash);

  const error = params.get('error');
  if (error) throw new Error(`Google retornou erro: ${error}`);

  const idToken = params.get('id_token');
  const state = params.get('state');
  if (!idToken) throw new Error('id_token ausente no retorno do Google.');

  const expectedState = sessionStorage.getItem(STATE_KEY);
  if (!expectedState || state !== expectedState) {
    throw new Error('State inválido (possível CSRF).');
  }

  const returnTo = sessionStorage.getItem(RETURN_KEY) ?? '/onboarding/api-keys';
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(NONCE_KEY);
  sessionStorage.removeItem(RETURN_KEY);

  return { idToken, returnTo };
}
