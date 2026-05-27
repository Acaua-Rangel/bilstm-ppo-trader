const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000';

export interface Me {
  id: number;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  binanceUid?: string | null;
  hasExchangeAccount: boolean;
}

export interface ExchangeAccountResponse {
  id: number;
  binanceUid: string;
  allocatedBalance: number;
  isPaperTrading: boolean;
  isActive: boolean;
  apiKeyMasked: string;
  createdAt: string;
}

export interface CreateExchangeAccountInput {
  apiKey: string;
  apiSecret: string;
  binanceUid?: string;
  allocatedBalance: number;
  isPaperTrading: boolean;
}

export interface UpdateExchangeAccountInput {
  allocatedBalance: number;
  isPaperTrading: boolean;
  isActive: boolean;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const body = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    const message = typeof body === 'string' ? body : body?.error ?? body?.title ?? 'Request failed';
    throw new Error(message);
  }
  return body as T;
}

export const api = {
  googleLogin: (idToken: string) =>
    request<Me>('/api/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) }),

  me: () => request<Me>('/api/auth/me'),

  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),

  listExchangeAccounts: () =>
    request<ExchangeAccountResponse[]>('/api/exchange-accounts'),

  createExchangeAccount: (input: CreateExchangeAccountInput) =>
    request<ExchangeAccountResponse>('/api/exchange-accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateExchangeAccount: (id: number, input: UpdateExchangeAccountInput) =>
    request<ExchangeAccountResponse>(`/api/exchange-accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  recentTrades: (hours = 24) =>
    request<TradeDecision[]>(`/api/trades/recent?hours=${hours}`),

  klines: (symbol = 'BTCFDUSD', interval = '15m', limit = 96) =>
    request<Kline[]>(`/api/market/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`),
};

export interface TradeDecision {
  id: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  price: number;
  amount: number;
  adx: number | null;
  pnl: number;
  type: 'PAPER' | 'REAL';
  timestamp: number; // unix seconds
}

export interface Kline {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
