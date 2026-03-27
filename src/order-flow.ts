// order-flow.ts — /order command handler for Telegram bot
// Registers all order-related handlers on the Telegraf bot instance.
// Does NOT modify any existing handlers.

import { Markup, type Telegraf } from 'telegraf';
import type { Context } from 'telegraf';
import { config } from './config';

// ─── Public API types ─────────────────────────────────────────────────────────

interface PublicCategory {
  id: string;
  name: string;
}

interface PublicProduct {
  id: string;
  name: string;
  price?: number | null;
  salePrice?: number | null;
  currentPrice?: number | null;
  description?: string;
  unit?: { name: string };
}

interface CreatedOrder {
  id: string;
  trackCode?: string | null;
  total: number;
  finalTotal?: number;
}

// ─── Cart & session ───────────────────────────────────────────────────────────

interface CartItem {
  productId:   string;
  productName: string;
  unitPrice:   number;
  quantity:    number;
}

// Cart is always carried in state so it survives step transitions.
interface BaseState { cart: CartItem[] }

type OrderState = BaseState & (
  | { step: 'SELECT_CATEGORY' }
  | { step: 'SELECT_PRODUCT';  products: PublicProduct[] }
  | { step: 'ENTER_QUANTITY';  product:  PublicProduct  }
  | { step: 'SHOW_CART'  }
  | { step: 'ENTER_PHONE' }
  | { step: 'CONFIRM';         phone: string }
);

/** In-memory session store. Key = Telegram user ID. */
const sessions = new Map<number, OrderState>();

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiGet<T>(path: string): Promise<T> {
  const res  = await fetch(`${config.erpApiBaseUrl}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`API ${res.status}: ${text || res.statusText}`);
  return JSON.parse(text) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res  = await fetch(`${config.erpApiBaseUrl}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch {}
    throw new Error(msg);
  }
  return JSON.parse(text) as T;
}

// ─── Format helpers ────────────────────────────────────────────────────────────

const money = (n: number) =>
  new Intl.NumberFormat('uz-UZ').format(Math.max(0, Math.round(n))) + " so'm";

const cartTotal = (cart: CartItem[]) =>
  cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

const cartLines = (cart: CartItem[]) =>
  cart.map(i =>
    `  • ${i.productName} — ${i.quantity} ta × ${money(i.unitPrice)} = ${money(i.unitPrice * i.quantity)}`
  ).join('\n');

const shortId = (id: string) => '#' + id.slice(0, 8).toUpperCase();

function senderName(ctx: Context): string {
  const f = ctx.from?.first_name ?? '';
  const l = ctx.from?.last_name  ?? '';
  return `${f} ${l}`.trim() || 'Foydalanuvchi';
}

// ─── Inline keyboards ─────────────────────────────────────────────────────────

const CANCEL_ROW = [Markup.button.callback('❌ Bekor qilish', 'order_cancel')];

function catKeyboard(cats: PublicCategory[]) {
  return Markup.inlineKeyboard([
    ...cats.map(c => [Markup.button.callback(c.name, `order_cat:${c.id}`)]),
    CANCEL_ROW,
  ]);
}

function prodKeyboard(products: PublicProduct[]) {
  // Max label length ~ 50 chars to keep button readable
  const rows = products
    .map(p => {
      const price = p.currentPrice ?? p.salePrice ?? p.price ?? 0;
      const label = `${p.name} — ${money(price)}`.slice(0, 50);
      return [Markup.button.callback(label, `order_prod:${p.id}`)];
    });
  return Markup.inlineKeyboard([
    ...rows,
    [Markup.button.callback('⬅️ Kategoriyalar', 'order_back_cat')],
    CANCEL_ROW,
  ]);
}

function cartKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Yana mahsulot qo'shish", 'order_more')],
    [Markup.button.callback('🛍️  Buyurtmani rasmiylashtirish', 'order_checkout')],
    CANCEL_ROW,
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Tasdiqlash', 'order_confirm')],
    [Markup.button.callback("✏️  O'zgartirish", 'order_more')],
    CANCEL_ROW,
  ]);
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function handleOrderStart(ctx: Context): Promise<void> {
  const uid = ctx.from?.id;
  if (!uid) return;

  try {
    const cats = await apiGet<PublicCategory[]>('/public/categories');
    if (!cats.length) {
      await ctx.reply("❌ Hozircha mahsulot kategoriyalari mavjud emas.");
      return;
    }
    sessions.set(uid, { step: 'SELECT_CATEGORY', cart: [] });
    await ctx.reply(
      "🎂 Buyurtma berish\n\nQaysi kategoriyadan mahsulot tanlaysiz?",
      catKeyboard(cats),
    );
  } catch (err) {
    console.error('[order:start]', err);
    await ctx.reply("⚠️ Ma'lumotlar yuklanmadi. Keyinroq urinib ko'ring.");
  }
}

export function registerOrderHandlers(bot: Telegraf): void {

  // ── /order ────────────────────────────────────────────────────────────────

  bot.command('order', handleOrderStart);

  // ── Category selected ─────────────────────────────────────────────────────

  bot.action(/^order_cat:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid        = ctx.from?.id;
    if (!uid) return;
    const categoryId = ctx.match[1];
    const state      = sessions.get(uid) ?? { step: 'SELECT_CATEGORY' as const, cart: [] };

    try {
      const products = await apiGet<PublicProduct[]>(
        `/public/products?categoryId=${encodeURIComponent(categoryId)}`,
      );
      const available = products;

      if (!available.length) {
        await ctx.editMessageText(
          "❌ Bu kategoriyada hozircha mahsulot yo'q.",
          Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Orqaga', 'order_back_cat')],
            CANCEL_ROW,
          ]),
        );
        return;
      }

      sessions.set(uid, { ...state, step: 'SELECT_PRODUCT', products });
      await ctx.editMessageText("🛍️ Mahsulot tanlang:", prodKeyboard(products));
    } catch (err) {
      console.error('[order:cat]', err);
      await ctx.editMessageText("⚠️ Mahsulotlar yuklanmadi. /order ni qayta yuboring.");
    }
  });

  // ── Back to categories ────────────────────────────────────────────────────

  bot.action('order_back_cat', async (ctx) => {
    await ctx.answerCbQuery();
    const uid   = ctx.from?.id;
    if (!uid) return;
    const state = sessions.get(uid) ?? { cart: [] };

    try {
      const cats = await apiGet<PublicCategory[]>('/public/categories');
      sessions.set(uid, { ...state, step: 'SELECT_CATEGORY' });
      await ctx.editMessageText(
        "🎂 Qaysi kategoriyadan mahsulot tanlaysiz?",
        catKeyboard(cats),
      );
    } catch {
      await ctx.editMessageText("⚠️ Xatolik. /order ni qayta yuboring.");
      sessions.delete(uid);
    }
  });

  // ── Product selected ──────────────────────────────────────────────────────

  bot.action(/^order_prod:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const uid       = ctx.from?.id;
    if (!uid) return;
    const productId = ctx.match[1];
    const state     = sessions.get(uid);

    // Recover product from cached list (avoids extra API call)
    let product: PublicProduct | undefined;
    if (state?.step === 'SELECT_PRODUCT') {
      product = state.products.find(p => p.id === productId);
    }

    if (!product) {
      await ctx.editMessageText("⚠️ Mahsulot topilmadi. /order ni qayta yuboring.");
      sessions.delete(uid);
      return;
    }

    const cart = state?.cart ?? [];
    sessions.set(uid, { step: 'ENTER_QUANTITY', cart, product });

    const lines = [
      `📦 ${product.name}`,
      product.description ? `   ${product.description}` : null,
      `💰 Narxi: ${money(product.currentPrice ?? product.salePrice ?? product.price ?? 0)} / ${product.unit?.name ?? 'dona'}`,
      ``,
      `✏️  Nechtasini buyurtma qilmoqchisiz? Sonni yozing:`,
    ].filter(Boolean).join('\n');

    await ctx.editMessageText(lines);
  });

  // ── Add more items (go back to categories, keep cart) ────────────────────

  bot.action('order_more', async (ctx) => {
    await ctx.answerCbQuery();
    const uid   = ctx.from?.id;
    if (!uid) return;
    const state = sessions.get(uid) ?? { cart: [] };
    const cart  = state.cart ?? [];

    try {
      const cats = await apiGet<PublicCategory[]>('/public/categories');
      sessions.set(uid, { step: 'SELECT_CATEGORY', cart });

      const cartNote = cart.length
        ? `🛒 Savatda: ${cart.length} ta mahsulot (${money(cartTotal(cart))})\n\n`
        : '';

      await ctx.editMessageText(
        `${cartNote}🎂 Qaysi kategoriyadan mahsulot qo'shasiz?`,
        catKeyboard(cats),
      );
    } catch {
      await ctx.editMessageText("⚠️ Xatolik. /order ni qayta yuboring.");
    }
  });

  // ── Checkout — ask for phone ──────────────────────────────────────────────

  bot.action('order_checkout', async (ctx) => {
    await ctx.answerCbQuery();
    const uid   = ctx.from?.id;
    if (!uid) return;
    const state = sessions.get(uid);

    if (!state?.cart?.length) {
      await ctx.answerCbQuery("❌ Savat bo'sh!");
      return;
    }

    sessions.set(uid, { ...state, step: 'ENTER_PHONE' });
    await ctx.editMessageText(
      [
        `📱 Telefon raqamingiz?`,
        ``,
        `Yetkazib berish uchun operator siz bilan bog'lanadi.`,
        `Format: +998901234567`,
        ``,
        `O'tkazib yuborish uchun — belgisini yuboring.`,
      ].join('\n'),
    );
  });

  // ── Confirm — submit order ────────────────────────────────────────────────

  bot.action('order_confirm', async (ctx) => {
    await ctx.answerCbQuery('Buyurtma yuborilmoqda...');
    const uid   = ctx.from?.id;
    if (!uid) return;
    const state = sessions.get(uid);

    if (state?.step !== 'CONFIRM' || !state.cart.length) {
      await ctx.reply("❌ Sessiya xatosi. /order ni qayta yuboring.");
      sessions.delete(uid);
      return;
    }

    try {
      const order = await apiPost<CreatedOrder>('/public/orders', {
        customerName:  senderName(ctx),
        phone:         state.phone !== '—' ? state.phone : undefined,
        channel:       'TELEGRAM',
        items: state.cart.map(i => ({
          productId: i.productId,
          quantity:  i.quantity,
        })),
      });

      sessions.delete(uid);

      await ctx.editMessageText(
        [
          `✅ Buyurtmangiz qabul qilindi!`,
          ``,
          `🆔 Buyurtma: ${shortId(order.id)}`,
          order.trackCode ? `📌 Track: ${order.trackCode}` : null,
          `💰 Jami: ${money(order.finalTotal ?? order.total)}`,
          ``,
          `⏰ Taxminiy vaqt: 2–3 soat`,
          `📞 Operator siz bilan bog'lanadi`,
          ``,
          `Rahmat! 🎂`,
        ].filter(Boolean).join('\n'),
      );
    } catch (err) {
      console.error('[order:submit]', err);
      const msg = err instanceof Error ? err.message : "Noma'lum xatolik";
      await ctx.editMessageText(
        `⚠️ Buyurtma jo'natilmadi:\n${msg}\n\nQayta urinish: /order`,
      );
      sessions.delete(uid);
    }
  });

  // ── Cancel ────────────────────────────────────────────────────────────────

  bot.action('order_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    const uid = ctx.from?.id;
    if (uid) sessions.delete(uid);
    await ctx.editMessageText(
      "❌ Buyurtma bekor qilindi.\n\nYangi buyurtma berish uchun /order.",
    );
  });

  // ── Text message handler (quantity & phone input) ─────────────────────────
  //
  // Registered LAST so existing bot.hears() handlers take precedence.
  // Only intercepts if the user has an active order session requiring text.

  bot.on('text', async (ctx, next) => {
    const uid = ctx.from?.id;
    if (!uid) return next();

    const state = sessions.get(uid);
    if (!state) return next();

    const text = ctx.message.text.trim();

    // Let commands through (they're handled elsewhere)
    if (text.startsWith('/')) return next();

    // ── Waiting for quantity ─────────────────────────────────────────────

    if (state.step === 'ENTER_QUANTITY') {
      const qty = parseInt(text, 10);

      if (isNaN(qty) || qty < 1 || qty > 99) {
        await ctx.reply("❌ Noto'g'ri son. 1 dan 99 gacha son kiriting.");
        return;
      }

      // Merge into existing cart (accumulate if same product)
      const idx     = state.cart.findIndex(i => i.productId === state.product.id);
      const newCart = idx >= 0
        ? state.cart.map((item, i) =>
            i === idx ? { ...item, quantity: item.quantity + qty } : item
          )
        : [
            ...state.cart,
            {
              productId:   state.product.id,
              productName: state.product.name,
              unitPrice:   state.product.currentPrice ?? state.product.salePrice ?? state.product.price ?? 0,
              quantity:    qty,
            },
          ];

      sessions.set(uid, { step: 'SHOW_CART', cart: newCart });

      await ctx.reply(
        [
          `✅ Qo'shildi: ${state.product.name} — ${qty} ta`,
          ``,
          `🛒 Savat:`,
          cartLines(newCart),
          `──────────────────`,
          `💰 Jami: ${money(cartTotal(newCart))}`,
        ].join('\n'),
        cartKeyboard(),
      );
      return;
    }

    // ── Waiting for phone ────────────────────────────────────────────────

    if (state.step === 'ENTER_PHONE') {
      const isSkip  = text === '—' || text === '-';
      const phoneOk = isSkip || /^\+?[\d\s\-]{7,16}$/.test(text);

      if (!phoneOk) {
        await ctx.reply(
          "❌ Noto'g'ri format. +998901234567 shaklida yozing,\n" +
          "yoki o'tkazib yuborish uchun — belgisini yuboring.",
        );
        return;
      }

      const phone = isSkip ? '—' : text;
      sessions.set(uid, { ...state, step: 'CONFIRM', phone });

      await ctx.reply(
        [
          `📋 Buyurtmani tasdiqlash:`,
          ``,
          `👤 Ism:     ${senderName(ctx)}`,
          `📞 Telefon: ${phone}`,
          ``,
          `🛒 Mahsulotlar:`,
          cartLines(state.cart),
          `──────────────────`,
          `💰 Jami: ${money(cartTotal(state.cart))}`,
          ``,
          `Tasdiqlaysizmi?`,
        ].join('\n'),
        confirmKeyboard(),
      );
      return;
    }

    // ── All other states — pass through ─────────────────────────────────

    return next();
  });
}
