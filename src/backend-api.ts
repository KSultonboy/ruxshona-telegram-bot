import { config } from './config';

export interface TelegramCashbackTransaction {
  id: string;
  type: 'EARN' | 'REDEEM' | 'ADJUSTMENT';
  amount: number;
  saleAmount: number;
  ratePercent: number;
  barcode: string;
  note?: string | null;
  createdAt: string;
}

export interface TelegramCashbackProfile {
  id: string;
  telegramId: string;
  username?: string | null;
  firstName: string;
  lastName?: string | null;
  barcode: string;
  balance: number;
  verifiedMember: boolean;
  lastMembershipStatus?: string | null;
  lastMembershipCheckAt?: string | null;
  transactions: TelegramCashbackTransaction[];
}

type SyncUserInput = {
  telegramId: string;
  username?: string;
  firstName: string;
  lastName?: string;
};

type MembershipInput = {
  verifiedMember: boolean;
  lastMembershipStatus?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.erpApiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-bot-key': config.botApiKey,
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ERP API ${response.status}: ${text || response.statusText}`);
  }

  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export async function syncTelegramCashbackUser(input: SyncUserInput) {
  return request<TelegramCashbackProfile>('/telegram-cashback/bot/users/sync', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getTelegramCashbackProfile(telegramId: string) {
  return request<TelegramCashbackProfile>(
    `/telegram-cashback/bot/users/${encodeURIComponent(telegramId)}`,
  );
}

export async function updateTelegramMembership(
  telegramId: string,
  input: MembershipInput,
) {
  return request<TelegramCashbackProfile>(
    `/telegram-cashback/bot/users/${encodeURIComponent(telegramId)}/membership`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}
