# sndemo

A small Android app that backs up files from your phone to **your own Telegram bot**.

- Choose files → **Back up now**. Each file goes to your chat with the bot.
- Big files are split into 19 MB parts (under Telegram's 50 MB upload / 20 MB
  bot download limits).
- Your bot **token stays in the phone's secure storage** — never in the app,
  the APK, or anything you share.

## Build the APK (no Mac, no Expo account)

1. Upload `sndemo.zip` to this repo, then run the **Unpack project zip** action.
2. Run the **Android APK** action. Download `sndemo-apk` from the finished run.

## Develop

```bash
npm install
npm run typecheck
npm test            # backup logic against a fake Telegram
npx expo run:android
```
