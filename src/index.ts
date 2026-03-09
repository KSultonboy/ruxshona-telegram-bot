import bwipjs from 'bwip-js';
import { Context, Markup, Telegraf } from 'telegraf';
import { checkMembership } from './membership';
import { config } from './config';
import { BotStorage } from './storage';
import {
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
  joinGroup: "🔗 Guruhga qo'shilish",
  checkMembership: "✅ A'zolikni tekshirish",
} as const;

const mainKeyboard = Markup.keyboard([
  [BUTTONS.balance, BUTTONS.barcode],
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
  const profile = await getOrCreateProfile(ctx);
  if (!profile) return;

  await ctx.reply(
    [
      `Assalomu alaykum, ${profile.firstName}.`,
      ``,
      `✨ Ruxshona Tort cashback botiga xush kelibsiz.`,
      `Bu yerda siz cashback balansingizni kuzatasiz va shaxsiy barcode'ingizni olasiz.`,
      ``,
      `Pastdagi menyudan kerakli bo'limni tanlang.`,
    ].join('\n'),
    mainKeyboard,
  );
});

bot.hears(BUTTONS.balance, async (ctx) => {
  const profile = await getOrCreateProfile(ctx);
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
  const profile = await getOrCreateProfile(ctx);
  if (!profile) return;

  await sendBarcode(ctx, profile);
});

bot.command('balance', async (ctx) => {
  const profile = await getOrCreateProfile(ctx);
  if (!profile) return;
  await ctx.reply(`💳 Joriy balansingiz: ${formatMoney(profile.balance)} so'm`, mainKeyboard);
});

bot.command('barcode', async (ctx) => {
  const profile = await getOrCreateProfile(ctx);
  if (!profile) return;
  await sendBarcode(ctx, profile);
});

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

bot.on('my_chat_member', async (ctx) => {
  const title = 'title' in ctx.chat ? ctx.chat.title : 'n/a';
  console.log(
    `[my_chat_member] chatId=${ctx.chat.id} title=${title} status=${ctx.myChatMember.new_chat_member.status}`,
  );
});

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
    await ctx.reply(`⚙️ A'zolik tekshiruvi hali sozlanmagan. REQUIRED_CHAT_ID ni kiriting.`);
    return;
  }

  try {
    const result = await checkMembership(bot, config.requiredChatId, ctx.from.id);

    storage.upsertUser(ctx.from.id, {
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      verifiedMember: result.ok,
      lastMembershipStatus: result.status,
      lastMembershipCheckAt: new Date().toISOString(),
    });

    await updateTelegramMembership(String(ctx.from.id), {
      verifiedMember: result.ok,
      lastMembershipStatus: result.status,
    });

    if (result.ok) {
      const profile = await getOrCreateProfile(ctx);
      if (!profile) return;

      await ctx.reply(
        `✅ A'zolik tasdiqlandi. Endi cashback barcode'ingiz tayyor.`,
        mainKeyboard,
      );
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
    error instanceof Error ? `${error.message} ${String((error as any).cause ?? '')}` : String(error);

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
