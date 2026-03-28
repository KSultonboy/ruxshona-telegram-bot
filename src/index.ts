import bwipjs from 'bwip-js';
import { Context, Markup, Telegraf } from 'telegraf';
import type { ChatMember, ChatMemberUpdated } from 'telegraf/types';
import { checkMembership, type MembershipResult, toMembershipResult } from './membership';
import { config } from './config';
import { BotStorage } from './storage';
import { registerOrderHandlers, handleOrderStart } from './order-flow';
import {
  confirmTelegramLink,
  getTelegramCashbackProfile,
  syncTelegramCashbackUser,
  updateTelegramMembership,
  type TelegramCashbackProfile,
} from './backend-api';

const bot = new Telegraf(config.botToken);
const storage = new BotStorage(config.stateFile);

const BUTTONS = {
  balance: '💳 Balansim',
  barcode: '🪪 Barcodeim',
  order: '🛍️ Buyurtma berish',
  joinGroup: "🔗 Guruhga qo'shilish",
  checkMembership: "✅ A'zolikni tekshirish",
} as const;

const mainKeyboard = Markup.keyboard([
  [BUTTONS.balance, BUTTONS.barcode],
  [BUTTONS.order],
]).resize();

const membershipKeyboard = Markup.inlineKeyboard([
  ...(config.requiredChatInviteUrl
    ? [[Markup.button.url(BUTTONS.joinGroup, config.requiredChatInviteUrl)]]
    : []),
  [Markup.button.callback(BUTTONS.checkMembership, 'check_membership')],
]);

bot.use(async (ctx, next) => {
  const from = ctx.from;
  if (from) {
    const existing = storage.getUser(from.id);
    storage.upsertUser(from.id, {
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      verifiedMember: existing?.verifiedMember ?? false,
      lastMembershipStatus: existing?.lastMembershipStatus ?? 'unknown',
      lastMembershipCheckAt: existing?.lastMembershipCheckAt,
    });
  }
  await next();
});

bot.start(async (ctx) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: string = (ctx as any).startPayload ?? '';

  console.log(`[start] from=${ctx.from?.id} username=${ctx.from?.username} payload=${JSON.stringify(payload)}`);

  if (!ctx.from) {
    await ctx.reply("Foydalanuvchi ma'lumoti topilmadi.");
    return;
  }

  if (payload) {
    // Deep link — store challenge, ask for contact (telegramId needed for confirm)
    storage.setPendingChallenge(ctx.from.id, payload);
    console.log(`[start] stored pendingChallengeId=${payload} for user=${ctx.from.id}`);
    await ctx.reply(
      [
        "Salom! Ruxshona To'rt cashback tizimiga xush kelibsiz! 🎂",
        '',
        "Davom etish uchun ma'lumotlaringizni ulashing:",
      ].join('\n'),
      Markup.keyboard([
        [Markup.button.contactRequest("✅ Ma'lumotlarni ulashish")],
      ]).resize().oneTime(),
    );
    return;
  }

  const existingUser = storage.getUser(ctx.from.id);
  if (existingUser) {
    // Returning user — go straight to main menu
    const profile = await getOrCreateProfile(ctx);
    if (!profile) return;
    await ctx.reply(
      [
        `Assalomu alaykum, ${profile.firstName}!`,
        '',
        `Pastdagi menyudan kerakli bo'limni tanlang.`,
      ].join('\n'),
      mainKeyboard,
    );
    return;
  }

  // New user — ask for contact
  await ctx.reply(
    [
      "Salom! Ruxshona To'rt cashback tizimiga xush kelibsiz! 🎂",
      '',
      "Davom etish uchun ma'lumotlaringizni ulashing:",
    ].join('\n'),
    Markup.keyboard([
      [Markup.button.contactRequest("✅ Ma'lumotlarni ulashish")],
    ]).resize().oneTime(),
  );
});

bot.on('contact', async (ctx) => {
  if (!ctx.from || !('contact' in ctx.message)) return;
  const contact = ctx.message.contact;
  const telegramId = String(ctx.from.id);

  console.log(`[contact] telegramId=${telegramId} phone=${contact.phone_number}`);

  // Sync user with backend
  try {
    await syncTelegramCashbackUser({
      telegramId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
  } catch (error) {
    console.error('[contact] backend sync failed:', error);
  }

  // Check for pending challenge (from deep link)
  const pendingChallengeId = storage.getPendingChallenge(ctx.from.id);
  console.log(`[contact] pendingChallengeId=${pendingChallengeId ?? 'none'}`);

  if (pendingChallengeId) {
    storage.clearPendingChallenge(ctx.from.id);
    try {
      console.log(`[contact] calling confirmTelegramLink challengeId=${pendingChallengeId} telegramId=${telegramId}`);
      const result = await confirmTelegramLink({ challengeId: pendingChallengeId, telegramId });
      console.log(`[contact] confirmTelegramLink ok, code=${result.code}`);
      await ctx.reply(
        `✅ Tasdiqlash kodingiz: *${result.code}*\n\nBu kodni website da kiriting.`,
        { parse_mode: 'Markdown', reply_markup: mainKeyboard.reply_markup },
      );
    } catch (error) {
      console.error('[contact] confirmTelegramLink failed:', error);
      await ctx.reply(
        "⚠️ Link tasdiqlanmadi. Checkout sahifasida qayta urinib ko'ring.",
        mainKeyboard,
      );
    }
    return;
  }

  // Normal flow: show profile
  const profile = await getOrCreateProfile(ctx);
  if (!profile) return;

  await ctx.reply(
    [
      `Assalomu alaykum, ${profile.firstName}! ✅`,
      ``,
      `💳 Balans: ${formatMoney(profile.balance)} so'm`,
      `🪪 Barcode: ${profile.barcode}`,
      ``,
      `Pastdagi menyudan kerakli bo'limni tanlang.`,
    ].join('\n'),
    mainKeyboard,
  );
});

bot.hears(BUTTONS.balance, async (ctx) => {
  const profile = await getProfileWithMembershipAccess(ctx, 'Balans');
  if (!profile) return;

  const lines = [
    `💳 Joriy balansingiz: ${formatMoney(profile.balance)} so'm`,
    `🪪 Barcode: ${profile.barcode}`,
  ];

  if (profile.transactions[0]) {
    const lastTransaction = profile.transactions[0];
    lines.push(
      `🕒 Oxirgi harakat: ${formatTransactionAmount(lastTransaction)} · ${formatDateTime(lastTransaction.createdAt)}`,
    );
  }

  await ctx.reply(lines.join('\n'), mainKeyboard);
});

bot.hears(BUTTONS.barcode, async (ctx) => {
  const profile = await getProfileWithMembershipAccess(ctx, 'Barcode');
  if (!profile) return;
  await sendBarcode(ctx, profile);
});

bot.command('balance', async (ctx) => {
  const profile = await getProfileWithMembershipAccess(ctx, 'Balans');
  if (!profile) return;
  await ctx.reply(`💳 Joriy balansingiz: ${formatMoney(profile.balance)} so'm`, mainKeyboard);
});

bot.command('barcode', async (ctx) => {
  const profile = await getProfileWithMembershipAccess(ctx, 'Barcode');
  if (!profile) return;
  await sendBarcode(ctx, profile);
});

bot.hears(BUTTONS.order, handleOrderStart);

bot.command('check', async (ctx) => {
  if (!config.membershipCheckEnabled) {
    await ctx.reply(
      `ℹ️ A'zolik tekshiruvi vaqtinchalik o'chirilgan. Cashback xizmati odatdagidek ishlayveradi.`,
      mainKeyboard,
    );
    return;
  }

  await handleMembershipCheck(ctx);
});

bot.action('check_membership', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.membershipCheckEnabled) {
    await ctx.reply(
      `ℹ️ A'zolik tekshiruvi vaqtinchalik o'chirilgan. Cashback xizmati odatdagidek ishlayveradi.`,
      mainKeyboard,
    );
    return;
  }

  await handleMembershipCheck(ctx);
});

bot.command('groupid', async (ctx) => {
  if (ctx.chat.type === 'private') {
    await ctx.reply(`Bu commandni guruh ichida yuboring.`);
    return;
  }

  const title = 'title' in ctx.chat ? (ctx.chat.title ?? "Noma'lum") : "Noma'lum";

  await ctx.reply(
    [
      `📌 Guruh nomi: ${title}`,
      `🆔 Chat ID: ${ctx.chat.id}`,
      `Shu qiymatni REQUIRED_CHAT_ID ga yozing.`,
    ].join('\n'),
  );
});

bot.command('status', async (ctx) => {
  if (!ctx.from) {
    await ctx.reply(`Foydalanuvchi ma'lumoti topilmadi.`);
    return;
  }

  const record = storage.getUser(ctx.from.id);
  if (!record) {
    await ctx.reply(`Hali tekshiruv ma'lumoti yo'q.`);
    return;
  }

  await ctx.reply(
    [
      `✅ Tasdiqlangan: ${record.verifiedMember ? 'ha' : "yo'q"}`,
      `📍 Oxirgi status: ${record.lastMembershipStatus}`,
      `🕒 Oxirgi tekshiruv: ${record.lastMembershipCheckAt ?? "hali yo'q"}`,
    ].join('\n'),
  );
});

bot.on('chat_member', async (ctx) => {
  await syncMembershipFromChatMemberUpdate(ctx);
});

bot.on('my_chat_member', async (ctx) => {
  const title = 'title' in ctx.chat ? ctx.chat.title : 'n/a';
  const status = ctx.myChatMember.new_chat_member.status;
  const required = config.requiredChatId;
  const forRequiredChat = required != null && sameChatId(required, ctx.chat.id);

  if (forRequiredChat && (status === 'left' || status === 'kicked')) {
    console.error(
      `[my_chat_member] bot removed from required chat: chatId=${ctx.chat.id} title=${title} status=${status}`,
    );
    return;
  }

  console.log(`[my_chat_member] chatId=${ctx.chat.id} title=${title} status=${status}`);
});

registerOrderHandlers(bot);

bot.catch((error) => {
  console.error('Telegram bot error', error);
});

async function getOrCreateProfile(ctx: Context) {
  if (!ctx.from) {
    await ctx.reply(`Foydalanuvchi ma'lumoti topilmadi.`);
    return null;
  }

  try {
    await syncTelegramCashbackUser({
      telegramId: String(ctx.from.id),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    return await getTelegramCashbackProfile(String(ctx.from.id));
  } catch (error) {
    console.error('ERP cashback sync failed', error);
    await ctx.reply(formatErpConnectionError(error), mainKeyboard);
    return null;
  }
}

async function getProfileWithMembershipAccess(ctx: Context, actionLabel: string) {
  const profile = await getOrCreateProfile(ctx);
  if (!profile) return null;

  const canAccess = await ensureMembershipAccess(ctx, profile, actionLabel);
  if (!canAccess) return null;

  return profile;
}

async function ensureMembershipAccess(
  ctx: Context,
  profile: TelegramCashbackProfile,
  actionLabel: string,
) {
  if (!config.membershipCheckEnabled) return true;

  if (!ctx.from) {
    await ctx.reply(`Foydalanuvchi ma'lumoti topilmadi.`);
    return false;
  }

  if (config.requiredChatId == null) {
    await ctx.reply(
      `⚙️ A'zolik tekshiruvi yoqilgan, lekin REQUIRED_CHAT_ID sozlanmagan. Administratorga murojaat qiling.`,
      mainKeyboard,
    );
    return false;
  }

  const latest = await getLatestMembershipState(ctx, profile);
  if (latest.ok) return true;

  await ctx.reply(
    [
      `🔒 ${actionLabel} bo'limi faqat a'zolar uchun ochiq.`,
      `Davom etish uchun ${config.requiredChatTitle} guruhiga qo'shilib, tekshiruvni bosing.`,
    ].join('\n'),
    membershipKeyboard,
  );
  return false;
}

async function getLatestMembershipState(ctx: Context, profile: TelegramCashbackProfile) {
  const now = Date.now();
  const record = storage.getUser(ctx.from!.id);
  const fallbackStatus = normalizeMembershipStatus(
    record?.lastMembershipStatus ?? profile.lastMembershipStatus ?? 'unknown',
  );
  const fallbackResult: MembershipResult = {
    ok: profile.verifiedMember || Boolean(record?.verifiedMember),
    status: fallbackStatus,
  };

  const lastCheckAt = record?.lastMembershipCheckAt ? Date.parse(record.lastMembershipCheckAt) : Number.NaN;
  const isFresh =
    Number.isFinite(lastCheckAt) &&
    now - lastCheckAt <= config.membershipStatusCacheTtlSeconds * 1000;

  if (isFresh) {
    return fallbackResult;
  }

  try {
    return await verifyAndPersistMembership(ctx, { notifyBackend: true });
  } catch (error) {
    console.error('Automatic membership re-check failed', error);
    return fallbackResult;
  }
}

async function sendBarcode(ctx: Context, profile: TelegramCashbackProfile) {
  try {
    const image = await bwipjs.toBuffer({
      bcid: 'ean13',
      text: profile.barcode,
      scale: 3,
      height: 14,
      includetext: true,
      textxalign: 'center',
      paddingwidth: 8,
      paddingheight: 8,
      backgroundcolor: 'FFFFFF',
    });

    await ctx.replyWithPhoto(
      { source: image, filename: `${profile.barcode}.png` },
      {
        caption: [
          `🪪 Shaxsiy cashback barcode'ingiz`,
          `Barcode: ${profile.barcode}`,
          `💳 Balans: ${formatMoney(profile.balance)} so'm`,
          `Kassada shu barcode'ni ko'rsatsangiz yetarli.`,
        ].join('\n'),
        reply_markup: mainKeyboard.reply_markup,
      },
    );
  } catch (error) {
    console.error('Barcode generation failed', error);
    await ctx.reply(
      [
        `⚠️ Barcode rasmi tayyorlanmadi, lekin raqam tayyor.`,
        `🪪 Barcode: ${profile.barcode}`,
        `💳 Balans: ${formatMoney(profile.balance)} so'm`,
      ].join('\n'),
      mainKeyboard,
    );
  }
}

async function handleMembershipCheck(ctx: Context) {
  if (!config.membershipCheckEnabled) {
    await ctx.reply(
      `ℹ️ A'zolik tekshiruvi vaqtinchalik o'chirilgan. Cashback xizmati odatdagidek ishlayveradi.`,
      mainKeyboard,
    );
    return;
  }

  if (!ctx.from) {
    await ctx.reply(`Foydalanuvchi ma'lumoti topilmadi.`);
    return;
  }

  if (config.requiredChatId == null) {
    await ctx.reply(
      `⚙️ A'zolik tekshiruvi yoqilgan, lekin REQUIRED_CHAT_ID sozlanmagan. Administratorga murojaat qiling.`,
      mainKeyboard,
    );
    return;
  }

  try {
    const result = await verifyAndPersistMembership(ctx, { notifyBackend: true });

    if (result.ok) {
      const profile = await getOrCreateProfile(ctx);
      if (!profile) return;

      await ctx.reply(`✅ A'zolik tasdiqlandi. Endi cashback barcode'ingiz tayyor.`, mainKeyboard);
      await sendBarcode(ctx, profile);
      return;
    }

    await ctx.reply(
      [
        `📍 Siz hali ${config.requiredChatTitle} guruhiga a'zo emassiz.`,
        `Avval guruhga qo'shiling, keyin tekshiruvni qayta ishga tushiring.`,
      ].join('\n'),
      membershipKeyboard,
    );
  } catch (error) {
    console.error('Membership check failed', error);
    await ctx.reply(
      [
        `⚠️ A'zolikni tekshirib bo'lmadi.`,
        `Bot guruhga admin qilinganini va REQUIRED_CHAT_ID to'g'ri ekanini tekshiring.`,
      ].join('\n'),
    );
  }
}

async function verifyAndPersistMembership(
  ctx: Context,
  options?: { notifyBackend?: boolean },
): Promise<MembershipResult> {
  if (!ctx.from) {
    return { ok: false, status: 'unknown' };
  }
  if (config.requiredChatId == null) {
    return { ok: false, status: 'unknown' };
  }

  const result = await checkMembership(bot, config.requiredChatId, ctx.from.id);
  await persistMembership(ctx.from.id, result, {
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
    notifyBackend: options?.notifyBackend ?? true,
  });

  return result;
}

async function syncMembershipFromChatMemberUpdate(ctx: Context) {
  if (!config.membershipCheckEnabled || config.requiredChatId == null) return;

  const update = (ctx.update as { chat_member?: ChatMemberUpdated }).chat_member;
  if (!update) return;
  if (!sameChatId(config.requiredChatId, update.chat.id)) return;

  const userId = update.new_chat_member.user.id;
  const result = toMembershipResult(update.new_chat_member as ChatMember);

  try {
    await persistMembership(userId, result, {
      username: update.new_chat_member.user.username,
      firstName: update.new_chat_member.user.first_name,
      lastName: update.new_chat_member.user.last_name,
      notifyBackend: true,
    });
  } catch (error) {
    console.error('chat_member membership sync failed', error);
  }
}

async function persistMembership(
  telegramUserId: number,
  result: MembershipResult,
  input: {
    username?: string;
    firstName?: string;
    lastName?: string;
    notifyBackend: boolean;
  },
) {
  const firstName = input.firstName ?? storage.getUser(telegramUserId)?.firstName ?? 'Telegram user';
  const nowIso = new Date().toISOString();

  storage.upsertUser(telegramUserId, {
    username: input.username,
    firstName,
    lastName: input.lastName,
    verifiedMember: result.ok,
    lastMembershipStatus: result.status,
    lastMembershipCheckAt: nowIso,
  });

  if (!input.notifyBackend) return;

  try {
    await updateTelegramMembership(String(telegramUserId), {
      verifiedMember: result.ok,
      lastMembershipStatus: result.status,
    });
  } catch (error) {
    console.error('ERP membership sync failed', error);
  }
}

function sameChatId(left: string | number, right: string | number) {
  return String(left) === String(right);
}

function normalizeMembershipStatus(
  value: string,
): MembershipResult['status'] {
  if (
    value === 'creator' ||
    value === 'administrator' ||
    value === 'member' ||
    value === 'restricted' ||
    value === 'left' ||
    value === 'kicked'
  ) {
    return value;
  }
  return 'unknown';
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('uz-UZ').format(Math.max(0, Math.round(value || 0)));
}

function formatTransactionAmount(transaction: TelegramCashbackProfile['transactions'][number]) {
  const prefix = transaction.type === 'REDEEM' ? '-' : '+';
  const label =
    transaction.type === 'REDEEM'
      ? 'yechildi'
      : transaction.type === 'ADJUSTMENT'
        ? 'tuzatildi'
        : "qo'shildi";
  return `${prefix}${formatMoney(transaction.amount)} so'm (${label})`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('uz-UZ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatErpConnectionError(error: unknown) {
  const message =
    error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}` : String(error);

  if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
    return [
      `⚠️ ERP bilan bog'lanib bo'lmadi.`,
      `Backend servisi ishlayotganini va API manzili to'g'ri kiritilganini tekshiring.`,
      `Servis tiklangach buyruqni qayta yuborishingiz mumkin.`,
    ].join('\n');
  }

  return `⚠️ ERP bilan bog'lanib bo'lmadi. BOT_API_KEY va ERP_API_BASE_URL ni tekshiring.`;
}

async function bootstrap() {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Botni ishga tushirish' },
    { command: 'balance', description: 'Cashback balansini ko‘rish' },
    { command: 'barcode', description: 'Shaxsiy barcode ni olish' },
    { command: 'check', description: "A'zolikni tekshirish" },
    { command: 'order', description: "Buyurtma berish" },
  ]);

  await bot.launch();
  console.log(`Telegram bot started.`);
}

bootstrap().catch((error) => {
  console.error('Telegram bot bootstrap failed', error);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
