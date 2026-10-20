/**
 * Send files to your own Telegram bot, in parts.
 *
 * A bot may upload 50 MB per file but download only 20 MB, so each file is cut
 * into parts of at most CHUNK bytes. The parts go to the chat as documents;
 * nothing else leaves the phone.
 *
 * No Expo imports here — the Telegram connection is passed in, so the tests run
 * against a fake one.
 */

/** 19 MiB: under both Telegram limits (50 MB upload, 20 MB bot download). */
export const CHUNK = 19 * 1024 * 1024;

export type SentDocument = { messageId: number; fileId: string; size: number };

/** The Bot API as this app uses it. telegramApi.ts talks to the real one. */
export interface TelegramTransport {
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Upload one part. `bytesLength` is only used to report progress. */
  sendDocument(chatId: string, fileUri: string, fileName: string, caption?: string): Promise<SentDocument>;
  sendDocumentBytes(chatId: string, bytes: Uint8Array, fileName: string, caption?: string): Promise<SentDocument>;
}

export class TelegramError extends Error {
  constructor(
    readonly code: number,
    description: string,
    readonly retryAfter?: number,
  ) {
    super(description);
    this.name = 'TelegramError';
  }
}

/** The bot has no messages from you yet: send it /start first. */
export class NeedsStartError extends Error {
  constructor() {
    super('send /start to the bot first');
    this.name = 'NeedsStartError';
  }
}

export const partCount = (size: number) => Math.max(1, Math.ceil(size / CHUNK));

/** "clip.mp4" stays as is when it fits; "clip.mp4.part02of05" otherwise. */
export function partName(base: string, i: number, n: number): string {
  if (n === 1) return base;
  const w = Math.max(2, String(n).length);
  return `${base}.part${String(i + 1).padStart(w, '0')}of${String(n).padStart(w, '0')}`;
}

export type ConnectResult = { chatId: string; chatName: string; botName: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry when Telegram asks to slow down (429) or the network blips. */
export async function retry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void> = defaultSleep, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const te = e instanceof TelegramError ? e : null;
      const transient = te ? te.code === 429 || te.code >= 500 : true;
      if (!transient || i >= attempts) throw e;
      await sleep(te?.retryAfter ? (te.retryAfter + 1) * 1000 : 1500 * i);
    }
  }
}

/**
 * Check the token and find your chat with the bot: the latest private message
 * anyone sent it (you, after /start). A hello message confirms it.
 */
export async function findChat(tx: TelegramTransport): Promise<ConnectResult> {
  const me = await tx.call<{ username?: string; first_name: string }>('getMe');
  const updates = await tx.call<
    { message?: { chat: { id: number; type: string; first_name?: string; username?: string } } }[]
  >('getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message'] });
  const chats = updates.map((u) => u.message?.chat).filter((c) => c && c.type === 'private');
  const chat = chats[chats.length - 1];
  if (!chat) throw new NeedsStartError();
  const chatId = String(chat.id);
  await tx.call('sendMessage', {
    chat_id: chatId,
    text: '✅ sndemo is connected. Files you back up will arrive in this chat.',
  });
  return { chatId, chatName: chat.first_name ?? chat.username ?? 'you', botName: me.username ?? me.first_name };
}

export type UploadProgress = { part: number; parts: number };

/**
 * Send one file to the chat, split into parts. `read` returns the bytes for a
 * byte range of the file. The caption on the first part names the file.
 */
export async function sendFile(
  tx: TelegramTransport,
  chatId: string,
  file: { name: string; size: number },
  read: (offset: number, length: number) => Promise<Uint8Array>,
  opts: { sleep?: (ms: number) => Promise<void>; onProgress?: (p: UploadProgress) => void } = {},
): Promise<{ parts: number }> {
  const n = partCount(file.size);
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  for (let i = 0; i < n; i++) {
    opts.onProgress?.({ part: i + 1, parts: n });
    const offset = i * CHUNK;
    const bytes = await read(offset, Math.min(CHUNK, file.size - offset));
    const caption = i === 0 ? `📎 ${file.name}${n > 1 ? ` · part 1 of ${n}` : ''}\n${when}` : undefined;
    await retry(() => tx.sendDocumentBytes(chatId, bytes, partName(file.name, i, n), caption), opts.sleep);
  }
  return { parts: n };
}
