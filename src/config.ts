import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  BOT_API_KEY: z.string().min(1, 'BOT_API_KEY is required'),
  MEMBERSHIP_CHECK_ENABLED: z.coerce.boolean().default(false),
  REQUIRED_CHAT_ID: z.string().optional(),
  REQUIRED_CHAT_TITLE: z.string().default('Ruxshona Tort'),
  REQUIRED_CHAT_INVITE_URL: z.string().optional(),
  ERP_API_BASE_URL: z.string().url().default('https://api.ruhshonatort.com/api'),
  BOT_STATE_FILE: z.string().default('./data/state.json'),
});

const parsed = schema.parse({
  BOT_TOKEN: process.env.BOT_TOKEN,
  BOT_API_KEY: process.env.BOT_API_KEY,
  MEMBERSHIP_CHECK_ENABLED: process.env.MEMBERSHIP_CHECK_ENABLED,
  REQUIRED_CHAT_ID: process.env.REQUIRED_CHAT_ID,
  REQUIRED_CHAT_TITLE: process.env.REQUIRED_CHAT_TITLE,
  REQUIRED_CHAT_INVITE_URL: process.env.REQUIRED_CHAT_INVITE_URL,
  ERP_API_BASE_URL: process.env.ERP_API_BASE_URL,
  BOT_STATE_FILE: process.env.BOT_STATE_FILE,
});

export const config = {
  botToken: parsed.BOT_TOKEN,
  botApiKey: parsed.BOT_API_KEY,
  membershipCheckEnabled: parsed.MEMBERSHIP_CHECK_ENABLED,
  requiredChatId: parsed.REQUIRED_CHAT_ID
    ? normalizeChatId(parsed.REQUIRED_CHAT_ID)
    : undefined,
  requiredChatTitle: parsed.REQUIRED_CHAT_TITLE,
  requiredChatInviteUrl: parsed.REQUIRED_CHAT_INVITE_URL || undefined,
  erpApiBaseUrl: parsed.ERP_API_BASE_URL,
  stateFile: path.resolve(process.cwd(), parsed.BOT_STATE_FILE),
};

function normalizeChatId(value: string): string | number {
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}
