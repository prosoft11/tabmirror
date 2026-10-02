import type { PairingView } from './pairing';
import type { State } from './engine';
type View = Omit<State, 'token'> & {
  connected: boolean;
  pairing?: PairingView;
};
const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let current: View | undefined;
let busy = false;
function render(state: View) {
  current = state;
  if (document.activeElement !== byId('name'))
    byId<HTMLInputElement>('name').value = state.deviceName;
  byId('controls').hidden = !state.connected;
  byId('pair-start').hidden = state.connected || !!state.pairing;
  byId('manual').hidden = state.connected || !!state.pairing;
  byId('pairing').hidden = !state.pairing;
  byId('pairing-code').textContent = state.pairing?.code ?? '';
  byId('pairing-name').textContent = state.pairing?.name ?? '';
  byId('pairing-status').textContent =
    state.pairing?.error ??
    'Waiting for your approval. This code expires after ten minutes.';
  byId('connect').hidden = state.connected;
  byId('token-label').hidden = state.connected;
  byId('pause').textContent = state.paused ? 'Resume sync' : 'Pause sync';
  byId<HTMLButtonElement>('sync').disabled =
    busy || state.paused || state.blocked;
  byId('status').textContent = !state.connected
    ? 'Not connected. Pair with your approved Google account.'
    : `${state.blocked ? 'Reconnect required' : state.paused ? 'Paused' : 'Automatic sync every 2 minutes'}\n${state.tabCount} tabs · ${state.windowCount} windows · ${state.omittedCount} omitted\nLast upload: ${state.lastSync ? new Date(state.lastSync).toLocaleString() : 'Not yet'}\nLast verified: ${state.lastCheck ? new Date(state.lastCheck).toLocaleString() : 'Not yet'}${state.error && !state.blocked ? `\nNext retry: ${new Date(state.nextAttemptAt).toLocaleTimeString()}` : ''}`;
  byId('error').textContent = state.error ?? '';
}
async function command(message: { command: string; [key: string]: unknown }) {
  if (busy) return;
  busy = true;
  const labels: Record<string, string> = {
    connect: 'Connecting and sending your first snapshot…',
    'pair-start': 'Creating your pairing code…',
    rename: 'Saving device name…',
    sync: 'Syncing your tabs…',
    pause: 'Updating sync state…',
    disconnect: 'Disconnecting…',
  };
  byId('activity').hidden = !labels[message.command];
  byId('activity-text').textContent = labels[message.command] ?? '';
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok)
      throw new Error(
        reply?.error ?? 'Extension is unavailable. Reload it and try again.',
      );
    render(reply.state);
  } catch (error) {
    byId('error').textContent =
      error instanceof Error ? error.message : 'Action failed.';
  } finally {
    busy = false;
    byId('activity').hidden = true;
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
    if (current)
      byId<HTMLButtonElement>('sync').disabled =
        current.paused || current.blocked;
  }
}
byId('connect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const token = byId<HTMLInputElement>('token').value;
  byId<HTMLInputElement>('token').value = '';
  void command({
    command: 'connect',
    token,
    name: byId<HTMLInputElement>('name').value,
  });
});
byId('rename').onclick = () =>
  void command({
    command: 'rename',
    name: byId<HTMLInputElement>('name').value,
  });
byId('sync').onclick = () => void command({ command: 'sync' });
byId('pause').onclick = () =>
  void command({ command: 'pause', paused: !current?.paused });
byId('disconnect').onclick = () => void command({ command: 'disconnect' });
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local' && !busy) void command({ command: 'status' });
});
void command({ command: 'status' });

byId('pair-start').onclick = () =>
  void command({
    command: 'pair-start',
    name: byId<HTMLInputElement>('name').value,
  });
byId('pair-open').onclick = () => void command({ command: 'pair-open' });
byId('pair-cancel').onclick = () => void command({ command: 'pair-cancel' });
setInterval(() => {
  if (current?.pairing && !busy) void command({ command: 'pair-poll' });
}, 5000);
