# Ruxshona Tort Telegram Bot

Bu servis ERP ichida emas, rootdagi alohida bot xizmatidir.

## Muhit o'zgaruvchilari

`.env.example` dan nusxa olib `.env` yarating.

- `BOT_TOKEN`: BotFather bergan token
- `BOT_API_KEY`: backend bilan umumiy secret. Shu qiymat `server/.env` dagi `TELEGRAM_BOT_API_KEY` bilan bir xil bo'lishi shart.
- `MEMBERSHIP_CHECK_ENABLED`: `true` bo'lsa a'zolik tekshiruvi ishlaydi, `false` bo'lsa vaqtincha o'chadi
- `ERP_API_BASE_URL`: cashback backend ishlayotgan API manzili
- `REQUIRED_CHAT_ID`: a'zolik tekshiruvi uchun guruh `chat id`. Bo'sh qoldirilsa membership qismi ishlamaydi.
- `REQUIRED_CHAT_TITLE`: guruh nomi
- `REQUIRED_CHAT_INVITE_URL`: guruhga qo'shilish linki
- `BOT_STATE_FILE`: local membership state fayli

## Backend env

Backend server `.env` ichida quyidagilar bo'lishi kerak:

- `TELEGRAM_BOT_TOKEN=<BOT_TOKEN bilan bir xil>`
- `TELEGRAM_BOT_API_KEY=<BOT_API_KEY bilan bir xil>`
- `TELEGRAM_CASHBACK_RATE_PERCENT=1`

## Ishga tushirish

```bash
npm install
npm run dev
```

## Cashback oqimi

1. Foydalanuvchi `/start` bosadi.
2. Bot backendda user yaratadi yoki mavjud userni sync qiladi.
3. Bot pastdagi tugmalarni beradi:
   - `💳 Balansim`
   - `🪪 Barcodeim`
4. `Mening barcodeim` bosilganda userga cashback barcode rasmi yuboriladi.
5. ERP kassada sotuv saqlangach shu barcode user balansiga cashback yoziladi.
6. Bot foydalanuvchiga cashback miqdori va yangi balans haqida xabar yuboradi.

## Membership check

1. Botni guruhga qo'shing va admin qiling.
2. Guruh ichida `/groupid` yuboring.
3. Chiqqan `chat id` ni `REQUIRED_CHAT_ID` ga yozing.
4. Keyin `/check` yoki inline tugma orqali a'zolik tekshiriladi.

## Production ishga tushirish

```bash
npm ci
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

Tavsiya etilgan production env:

- `ERP_API_BASE_URL=http://127.0.0.1:8090/api`
- `BOT_API_KEY` va backenddagi `TELEGRAM_BOT_API_KEY` bir xil bo'lishi shart
- `MEMBERSHIP_CHECK_ENABLED=false` yoki `true` holatiga qarab boshqariladi
