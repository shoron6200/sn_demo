import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';

import { backupFiles } from '../backup';
import type { HistoryEntry, HistoryStore, PickedFile } from '../types';
import { CHUNK, findChat, NeedsStartError, partName, TelegramError, type SentDocument, type TelegramTransport } from '../telegram';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** A Telegram chat with the real limits: 50 MB per upload, 20 MB per download. */
class FakeTelegram implements TelegramTransport {
  docs: { name: string; bytes: Uint8Array; caption?: string }[] = [];
  messages: string[] = [];
  updates: unknown[] = [{ message: { chat: { id: 7, type: 'private', first_name: 'Paulo' } } }];
  throttle = 0;
  private n = 0;

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (method === 'getMe') return { username: 'my_bot', first_name: 'Bot' } as T;
    if (method === 'getUpdates') return this.updates as T;
    if (method === 'sendMessage') {
      this.messages.push(String(params.text));
      return { message_id: ++this.n } as T;
    }
    throw new TelegramError(400, `unknown ${method}`);
  }

  private keep(bytes: Uint8Array, name: string, caption?: string): SentDocument {
    if (this.throttle > 0) {
      this.throttle--;
      throw new TelegramError(429, 'Too Many Requests', 1);
    }
    if (bytes.length > 50 * 1024 * 1024) throw new TelegramError(413, 'Request Entity Too Large');
    this.docs.push({ name, bytes: bytes.slice(), caption });
    return { messageId: ++this.n, fileId: `f${this.n}`, size: bytes.length };
  }

  async sendDocument(_chat: string, _uri: string, _name: string, _caption?: string): Promise<SentDocument> {
    throw new Error('tests use sendDocumentBytes');
  }
  async sendDocumentBytes(_chat: string, bytes: Uint8Array, name: string, caption?: string) {
    return this.keep(bytes, name, caption);
  }
}

/** Files held in memory; read() serves any byte range. */
function memoryFiles(defs: Record<string, Uint8Array>) {
  const files: PickedFile[] = Object.entries(defs).map(([name, b]) => ({ uri: `mem://${name}`, name, size: b.length, mime: null }));
  const read = async (uri: string, offset: number, length: number) => {
    const b = defs[uri.replace('mem://', '')];
    return b.slice(offset, offset + length);
  };
  return { files, read };
}

/** History kept in an array, like the phone's JSON file. */
function memHistory(): HistoryStore {
  let list: HistoryEntry[] = [];
  return {
    read: async () => list,
    add: async (e) => (list = [...e, ...list].slice(0, 50)),
    clear: async () => void (list = []),
  };
}

const deps = (tx: FakeTelegram, read: (u: string, o: number, l: number) => Promise<Uint8Array>) => ({
  tx,
  chatId: '7',
  history: memHistory(),
  read,
  now: () => 1000,
  sleep: async () => undefined,
});

describe('connect', () => {
  test('finds your private chat and says hello', async () => {
    const tx = new FakeTelegram();
    assert.deepEqual(await findChat(tx), { chatId: '7', chatName: 'Paulo', botName: 'my_bot' });
    assert.match(tx.messages.at(-1)!, /connected/);
  });

  test('without /start it asks for it', async () => {
    const tx = new FakeTelegram();
    tx.updates = [];
    await assert.rejects(findChat(tx), NeedsStartError);
  });
});

describe('part names', () => {
  test('one part keeps the name, many parts number it', () => {
    assert.equal(partName('a.mp4', 0, 1), 'a.mp4');
    assert.equal(partName('a.mp4', 1, 3), 'a.mp4.part02of03');
  });
});

describe('backup', () => {
  test('a small file goes in one part with a caption; history records it', async () => {
    const tx = new FakeTelegram();
    const { files, read } = memoryFiles({ 'note.txt': new Uint8Array([1, 2, 3]) });
    const r = await backupFiles(files, deps(tx, read));
    assert.equal(r.sent, 1);
    assert.equal(r.failed.length, 0);
    assert.equal(tx.docs.length, 1);
    assert.equal(tx.docs[0].name, 'note.txt');
    assert.match(tx.docs[0].caption!, /note\.txt/);
    assert.deepEqual(r.history[0], { name: 'note.txt', size: 3, parts: 1, at: 1000 });
  });

  test('a 45 MB file is split into parts under 20 MB and reassembles byte for byte', async () => {
    const tx = new FakeTelegram();
    const big = randomBytes(45 * 1024 * 1024);
    const { files, read } = memoryFiles({ 'clip.mp4': big });
    const r = await backupFiles(files, deps(tx, read));
    assert.equal(r.sent, 1);
    const parts = tx.docs.filter((d) => d.name.startsWith('clip.mp4'));
    assert.equal(parts.length, 3);
    assert.equal(parts[0].name, 'clip.mp4.part01of03');
    assert.ok(parts.every((p) => p.bytes.length <= CHUNK && p.bytes.length < 20 * 1000 * 1000));
    const joined = Buffer.concat(parts.map((p) => Buffer.from(p.bytes)));
    assert.equal(sha(new Uint8Array(joined)), sha(big));
    assert.equal(r.history[0].parts, 3);
  });

  test('several files; one that fails does not stop the rest', async () => {
    const tx = new FakeTelegram();
    // 60 MB is over the 50 MB per-part limit only if it were one part — but it is
    // chunked, so instead force a failure with a throttle that never clears.
    const { files, read } = memoryFiles({ 'a.txt': new Uint8Array([1]), 'b.txt': new Uint8Array([2]), 'c.txt': new Uint8Array([3]) });
    // Make the 2nd upload fail for good: 6 retries at 429.
    tx.throttle = 99;
    tx.throttle = 0; // reset; we fail differently below
    const r = await backupFiles(files, { ...deps(tx, read), read: async (uri, o, l) => {
      if (uri.includes('b.txt')) throw new Error('read error');
      return read(uri, o, l);
    } });
    assert.equal(r.sent, 2);
    assert.equal(r.failed.length, 1);
    assert.equal(r.failed[0].name, 'b.txt');
  });

  test('retries when Telegram says slow down', async () => {
    const tx = new FakeTelegram();
    const waits: number[] = [];
    const { files, read } = memoryFiles({ 'x.txt': new Uint8Array([9]) });
    tx.throttle = 2;
    await backupFiles(files, { ...deps(tx, read), sleep: async (ms) => void waits.push(ms) });
    assert.deepEqual(waits, [2000, 2000]);
    assert.equal(tx.docs.length, 1);
  });
});
