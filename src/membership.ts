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
  return toMembershipResult(member);
}

export function toMembershipResult(member: ChatMember): MembershipResult {
  const status = normalizeStatus(member.status);
  const isRestrictedMember =
    status === 'restricted' &&
    typeof (member as { is_member?: unknown }).is_member === 'boolean' &&
    Boolean((member as { is_member?: boolean }).is_member);

  return {
    ok: isMembershipAllowed(status, isRestrictedMember),
    status,
  };
}

export function isMembershipAllowed(status: MembershipResult['status'], isRestrictedMember = false) {
  return (
    status === 'creator' ||
    status === 'administrator' ||
    status === 'member' ||
    (status === 'restricted' && isRestrictedMember)
  );
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
