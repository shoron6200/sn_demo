/**
 * sndemo — back up files from this phone to your own Telegram bot.
 *
 * One screen:
 *   - not connected: paste your bot token, Connect.
 *   - connected: Choose files → Back up now. A list shows what was sent.
 *
 * The token stays in this phone's secure storage. It is never in the app or
 * anything you share.
 */
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { backupFiles, type FileProgress } from './src/backup';
import { fileHistory, pickFiles, readRange } from './src/fileAccess';
import type { HistoryEntry, PickedFile } from './src/types';
import { findChat, NeedsStartError, TelegramError } from './src/telegram';
import {
  clearCredentials,
  createTransport,
  getLink,
  getToken,
  looksLikeToken,
  saveCredentials,
  telegramSupported,
  type TelegramLink,
} from './src/telegramApi';

const BLUE = '#2f6fe0';
const BG = '#0f1115';
const CARD = '#191c22';
const LINE = '#2a2e37';
const TEXT = '#f2f3f5';
const MUTED = '#9aa0ab';
const RED = '#e0574f';
const GREEN = '#3fae6b';

function explain(e: unknown): string {
  if (e instanceof NeedsStartError) return 'The bot hasn’t heard from you yet. Open it in Telegram, tap Start, then Connect again.';
  if (e instanceof TelegramError) {
    if (e.code === 401 || e.code === 404) return 'That token doesn’t work. Copy it again from @BotFather.';
    if (e.code === 403) return 'The bot can’t message you. Unblock it and tap Start in Telegram.';
    if (e.code === 0) return 'Telegram can’t be reached. Check the connection and try again.';
    if (e.code === 429) return 'Telegram asked to slow down. Try again in a minute.';
    return `Telegram said: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

const prettySize = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const prettyWhen = (t: number) => new Date(t).toLocaleString();

function Button({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || busy;
  const bg = kind === 'primary' ? BLUE : 'transparent';
  const fg = kind === 'danger' ? RED : kind === 'ghost' ? MUTED : '#ffffff';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: kind === 'primary' ? BLUE : LINE, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

function Screen() {
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(true);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [token, setToken] = useState('');
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState<null | 'connect' | 'backup'>(null);
  const [progress, setProgress] = useState<FileProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ok = Platform.OS !== 'web' && (await telegramSupported().catch(() => false));
      setSupported(ok);
      if (ok) {
        setLink(await getLink());
        setHistory(await fileHistory.read());
      }
      setReady(true);
    })();
  }, []);

  const connect = async () => {
    setError(null);
    setNote(null);
    const clean = token.trim();
    if (!looksLikeToken(clean)) {
      setError('That doesn’t look like a bot token. It looks like 123456789:AA…');
      return;
    }
    setBusy('connect');
    try {
      const found = await findChat(createTransport(clean));
      await saveCredentials(clean, found);
      setLink(found);
      setToken('');
      setNote(`Connected. A hello message is waiting in your chat, ${found.chatName}.`);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  const choose = async () => {
    setError(null);
    setNote(null);
    try {
      const files = await pickFiles();
      if (files.length) setPicked(files);
    } catch {
      setError('Couldn’t open the file picker.');
    }
  };

  const backup = async () => {
    if (!link || !picked.length) return;
    setError(null);
    setNote(null);
    setBusy('backup');
    setProgress(null);
    try {
      const token = await getToken();
      if (!token) throw new TelegramError(401, 'not connected');
      const res = await backupFiles(picked, {
        tx: createTransport(token),
        chatId: link.chatId,
        history: fileHistory,
        read: readRange,
        onProgress: setProgress,
      });
      setHistory(res.history);
      setPicked([]);
      if (res.failed.length === 0) setNote(res.sent === 1 ? '1 file backed up.' : `${res.sent} files backed up.`);
      else setError(`${res.sent} sent, ${res.failed.length} failed (${res.failed.map((f) => f.name).join(', ')}).`);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const disconnect = () => {
    Alert.alert('Disconnect?', 'The token is removed from this phone. Files already in your chat stay there.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await clearCredentials();
          setLink(null);
          setNote('Disconnected.');
        },
      },
    ]);
  };

  const forget = () => {
    Alert.alert('Clear the list?', 'This only clears the on-screen history. Your files in Telegram are not touched.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await fileHistory.clear();
          setHistory([]);
        },
      },
    ]);
  };

  const progressText = progress
    ? `Sending ${progress.index} of ${progress.total}: ${progress.file}${progress.parts > 1 ? ` (part ${progress.part}/${progress.parts})` : ''}`
    : busy === 'backup'
      ? 'Starting…'
      : null;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>sndemo</Text>
        <Text style={styles.sub}>Back up files to your own Telegram bot.</Text>

        {ready && !supported ? (
          <View style={styles.card}>
            <Text style={styles.body}>This app needs a phone. The web preview can’t store your token safely.</Text>
          </View>
        ) : null}

        {supported && !link ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Connect your bot</Text>
            <Text style={styles.step}>1. In Telegram, open @BotFather, send /newbot and follow it. It gives you a token.</Text>
            <Text style={styles.step}>2. Open your new bot and tap Start.</Text>
            <Text style={styles.step}>3. Paste the token here and Connect.</Text>
            <TextInput
              style={styles.input}
              value={token}
              onChangeText={setToken}
              placeholder="123456789:AA…"
              placeholderTextColor={MUTED}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>The token stays in this phone’s secure storage. It isn’t in the app or anything you share.</Text>
            <Button label="Connect" onPress={connect} busy={busy === 'connect'} disabled={!token.trim()} />
          </View>
        ) : null}

        {supported && link ? (
          <>
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>@{link.botName}</Text>
                  <Text style={styles.muted}>chat with {link.chatName}</Text>
                </View>
                <Pressable onPress={disconnect} accessibilityRole="button">
                  <Text style={{ color: MUTED }}>Disconnect</Text>
                </Pressable>
              </View>

              <View style={{ height: 12 }} />
              <Button label={picked.length ? `${picked.length} file${picked.length === 1 ? '' : 's'} chosen — choose again` : 'Choose files'} onPress={choose} kind="ghost" disabled={!!busy} />

              {picked.length ? (
                <View style={styles.pickList}>
                  {picked.slice(0, 6).map((f, i) => (
                    <Text key={i} style={styles.pickItem} numberOfLines={1}>
                      {f.name} · {prettySize(f.size)}
                    </Text>
                  ))}
                  {picked.length > 6 ? <Text style={styles.muted}>+{picked.length - 6} more</Text> : null}
                </View>
              ) : null}

              <View style={{ height: 10 }} />
              <Button label="Back up now" onPress={backup} busy={busy === 'backup'} disabled={!picked.length || !!busy} />

              {progressText ? (
                <Text style={styles.progress} accessibilityLiveRegion="polite">
                  {progressText}
                </Text>
              ) : null}
            </View>

            <View style={styles.rowBetween}>
              <Text style={styles.listTitle}>Backed up</Text>
              {history.length ? (
                <Pressable onPress={forget} accessibilityRole="button">
                  <Text style={{ color: MUTED }}>Clear list</Text>
                </Pressable>
              ) : null}
            </View>
            {history.length ? (
              <FlatList
                scrollEnabled={false}
                data={history}
                keyExtractor={(_, i) => String(i)}
                renderItem={({ item }) => (
                  <View style={styles.histRow}>
                    <Text style={styles.histName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.muted}>
                      {prettySize(item.size)}
                      {item.parts > 1 ? ` · ${item.parts} parts` : ''} · {prettyWhen(item.at)}
                    </Text>
                  </View>
                )}
              />
            ) : (
              <Text style={styles.muted}>Nothing yet. Choose files and back them up.</Text>
            )}
          </>
        ) : null}

        {note ? <Text style={[styles.banner, { color: GREEN }]}>{note}</Text> : null}
        {error ? <Text style={[styles.banner, { color: RED }]}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { padding: 20, gap: 14 },
  h1: { color: TEXT, fontSize: 30, fontWeight: '800', letterSpacing: 0.3 },
  sub: { color: MUTED, fontSize: 15, marginTop: -6, marginBottom: 4 },
  card: { backgroundColor: CARD, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: LINE, padding: 16, gap: 8 },
  cardTitle: { color: TEXT, fontSize: 18, fontWeight: '700' },
  step: { color: MUTED, fontSize: 14, lineHeight: 20 },
  body: { color: TEXT, fontSize: 15, lineHeight: 21 },
  input: {
    backgroundColor: '#11141a',
    borderColor: LINE,
    borderWidth: 1,
    borderRadius: 10,
    color: TEXT,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 4,
  },
  hint: { color: MUTED, fontSize: 12, lineHeight: 17 },
  btn: { borderRadius: 12, borderWidth: 1, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  btnText: { fontSize: 16, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickList: { gap: 4, marginTop: 8 },
  pickItem: { color: TEXT, fontSize: 14 },
  progress: { color: BLUE, fontSize: 13, marginTop: 10, textAlign: 'center' },
  listTitle: { color: TEXT, fontSize: 16, fontWeight: '700', marginTop: 4 },
  histRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  histName: { color: TEXT, fontSize: 15, fontWeight: '600' },
  muted: { color: MUTED, fontSize: 13 },
  banner: { fontSize: 14, textAlign: 'center', marginTop: 4, lineHeight: 20 },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <Screen />
    </SafeAreaProvider>
  );
}
