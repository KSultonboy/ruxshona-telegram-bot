import type { Telegraf } from 'telegraf';
import type { ChatMember } from 'telegraf/types';

export type MembershipResult = {
  ok: boolean;
  status:
    | 'creator'
    | 'administrator'
    | 'member'
    | 'restricted'
    | 'left'
    | 'kicked'
    | 'unknown';
};

export async function checkMembership(
  bot: Telegraf,
  chatId: string | number,
  userId: number,
): Promise<MembershipResult> {
  const member = (await bot.telegram.getChatMember(chatId, userId)) as ChatMember;
  const status = normalizeStatus(member.status);

  return {
    ok: ['creator', 'administrator', 'member', 'restricted'].includes(status),
    status,
  };
}

function normalizeStatus(status: string): MembershipResult['status'] {
  if (
    status === 'creator' ||
    status === 'administrator' ||
    status === 'member' ||
    status === 'restricted' ||
    status === 'left' ||
    status === 'kicked'
  ) {
    return status;
  }
  return 'unknown';
}
