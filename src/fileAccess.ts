/**
 * Picking files, reading a byte range of one, and the local history of what
 * has been sent (so the app can show "last backed up" without re-reading the
 * chat). History is a small JSON file in the app's own folder.
 */
import * as DocumentPicker from 'expo-document-picker';

import type { HistoryEntry, HistoryStore, PickedFile } from './types';
import { Directory, File, FileMode, Paths } from 'expo-file-system';


export async function pickFiles(): Promise<PickedFile[]> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return [];
  return res.assets.map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? 0, mime: a.mimeType ?? null }));
}

/** Read one byte range of a file (for chunking). */
export async function readRange(uri: string, offset: number, length: number): Promise<Uint8Array> {
  const h = new File(uri).open(FileMode.ReadOnly);
  try {
    h.offset = offset;
    return await h.readBytes(length);
  } finally {
    h.close();
  }
}

export async function fileSize(uri: string): Promise<number> {
  const f = new File(uri);
  return f.exists ? f.size : 0;
}

// ------------------------------------------------------------ history

function historyFile(): File {
  const dir = new Directory(Paths.document, 'sndemo');
  if (!dir.exists) dir.create({ intermediates: true });
  return new File(dir, 'history.json');
}

async function readHistory(): Promise<HistoryEntry[]> {
  const f = historyFile();
  if (!f.exists) return [];
  try {
    const list = JSON.parse(await f.text()) as HistoryEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Reads and writes the history JSON in the app's own folder. */
export const fileHistory: HistoryStore = {
  read: readHistory,
  async add(entries) {
    const all = [...entries, ...(await readHistory())].slice(0, 50);
    const f = historyFile();
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(all));
    return all;
  },
  async clear() {
    const f = historyFile();
    if (f.exists) f.delete();
  },
};
