/**
 * One backup run: send each picked file to the chat and record it. Pure glue,
 * so a fake transport and file reader drive it in the tests.
 */
import type { HistoryEntry, HistoryStore, PickedFile } from './types';
import { sendFile, type TelegramTransport, type UploadProgress } from './telegram';

export type FileProgress = { index: number; total: number; file: string } & UploadProgress;

export type BackupResult = {
  sent: number;
  failed: { name: string; reason: string }[];
  history: HistoryEntry[];
};

export type BackupDeps = {
  tx: TelegramTransport;
  chatId: string;
  history: HistoryStore;
  read: (uri: string, offset: number, length: number) => Promise<Uint8Array>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (p: FileProgress) => void;
};

export async function backupFiles(files: PickedFile[], deps: BackupDeps): Promise<BackupResult> {
  const now = deps.now ?? Date.now;
  const done: HistoryEntry[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    try {
      const { parts } = await sendFile(
        deps.tx,
        deps.chatId,
        { name: f.name, size: f.size },
        (offset, length) => deps.read(f.uri, offset, length),
        {
          sleep: deps.sleep,
          onProgress: (p) => deps.onProgress?.({ index: i + 1, total: files.length, file: f.name, ...p }),
        },
      );
      done.push({ name: f.name, size: f.size, parts, at: now() });
    } catch (e) {
      failed.push({ name: f.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  const history = done.length ? await deps.history.add(done) : await deps.history.read();
  return { sent: done.length, failed, history };
}
