/**
 * The real Telegram connection, and where the bot token lives.
 *
 * The token is typed into the app on your phone and kept in the system's secure
 * storage (Android Keystore / iOS Keychain). It is never in the code, the APK,
 * or a log, so sharing the app shares nothing of your bot.
 */
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { TelegramError, type SentDocument, type TelegramTransport } from './telegram';

const TOKEN_KEY = 'sndemo.telegram.token';
const CHAT_KEY = 'sndemo.telegram.chat';

export type TelegramLink = { chatId: string; chatName: string; botName: string };

/** Rough shape check before any network call: "123456789:AA..." */
export const looksLikeToken = (t: string) => /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(t.trim());

export const telegramSupported = () => SecureStore.isAvailableAsync();

export async function saveCredentials(token: string, link: TelegramLink) {
  await SecureStore.setItemAsync(TOKEN_KEY, token.trim());
  await SecureStore.setItemAsync(CHAT_KEY, JSON.stringify(link));
}

export async function getLink(): Promise<TelegramLink | null> {
  const raw = await SecureStore.getItemAsync(CHAT_KEY).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TelegramLink;
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
}

export async function clearCredentials() {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(CHAT_KEY).catch(() => undefined);
}

type ApiReply<T> = { ok: boolean; result: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };

function unwrap<T>(r: ApiReply<T>): T {
  if (!r.ok) throw new TelegramError(r.error_code ?? 0, r.description ?? 'Telegram error', r.parameters?.retry_after);
  return r.result;
}

/** Errors never carry the URL: it contains the token. */
function scrub(e: unknown): never {
  if (e instanceof TelegramError) throw e;
  throw new TelegramError(0, 'network error');
}

export function createTransport(token: string): TelegramTransport {
  const base = `https://api.telegram.org/bot${token}`;
  const scratch = () => {
    const d = new Directory(Paths.cache, 'tg', Crypto.randomUUID());
    d.create({ intermediates: true });
    return d;
  };

  async function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    try {
      const res = await fetch(`${base}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      return unwrap<T>((await res.json()) as ApiReply<T>);
    } catch (e) {
      return scrub(e);
    }
  }

  async function uploadFile(chatId: string, f: File, fileName: string, caption?: string): Promise<SentDocument> {
    const parameters: Record<string, string> = {
      chat_id: chatId,
      disable_notification: 'true',
      disable_content_type_detection: 'true',
    };
    if (caption) parameters.caption = caption;
    const res = await f
      .upload(`${base}/sendDocument`, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'document',
        mimeType: 'application/octet-stream',
        parameters,
      })
      .catch(scrub);
    const msg = unwrap(JSON.parse(res.body) as ApiReply<{ message_id: number; document?: { file_id: string; file_size?: number } }>);
    if (!msg.document) throw new TelegramError(0, 'Telegram did not keep the file');
    return { messageId: msg.message_id, fileId: msg.document.file_id, size: msg.document.file_size ?? f.size };
  }

  return {
    call,

    async sendDocument(chatId, fileUri, fileName, caption) {
      // A whole small file by its uri: no copy needed.
      return uploadFile(chatId, new File(fileUri), fileName, caption);
    },

    async sendDocumentBytes(chatId, bytes, fileName, caption) {
      const dir = scratch();
      try {
        const f = new File(dir, fileName);
        f.create();
        f.write(bytes);
        return await uploadFile(chatId, f, fileName, caption);
      } finally {
        dir.delete();
      }
    },
  };
}
