/** Shared, dependency-free types (so the tests can import them without Expo). */
export type PickedFile = { uri: string; name: string; size: number; mime: string | null };
export type HistoryEntry = { name: string; size: number; parts: number; at: number };

/** How history is persisted. The phone passes the real one; tests pass a fake. */
export interface HistoryStore {
  read(): Promise<HistoryEntry[]>;
  add(entries: HistoryEntry[]): Promise<HistoryEntry[]>;
  clear(): Promise<void>;
}
