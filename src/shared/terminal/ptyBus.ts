// One listener for every terminal's output. Each session keeps a capped
// replay of its recent output, so a view that subscribes late (the shell's
// first prompt arrives while React is still mounting) or remounts (React's
// development double-mount) shows everything. Freed with `forgetPty`.

import { onPtyExit, onPtyOutput } from "../../api";

interface Subscriber {
  onData: (data: Uint8Array) => void;
  onExit: () => void;
}

/** Replay kept per session, at most this many bytes. */
const MAX_REPLAY = 256 * 1024;

interface Replay {
  chunks: Uint8Array[];
  bytes: number;
  exited: boolean;
}

const subscribers = new Map<number, Subscriber>();
const replays = new Map<number, Replay>();
let started: Promise<void> | null = null;

function replayOf(id: number): Replay {
  let r = replays.get(id);
  if (!r) {
    r = { chunks: [], bytes: 0, exited: false };
    replays.set(id, r);
  }
  return r;
}

function start(): Promise<void> {
  started ??= Promise.all([
    onPtyOutput(({ id, data }) => {
      const bytes = new Uint8Array(data);
      const r = replayOf(id);
      r.chunks.push(bytes);
      r.bytes += bytes.length;
      while (r.bytes > MAX_REPLAY && r.chunks.length > 1) r.bytes -= r.chunks.shift()!.length;
      subscribers.get(id)?.onData(bytes);
    }),
    onPtyExit((id) => {
      replayOf(id).exited = true;
      subscribers.get(id)?.onExit();
    }),
  ])
    .then(() => undefined)
    .catch((e) => {
      // Let the next terminal try again.
      started = null;
      throw e;
    });
  return started;
}

/** Listen early (call before spawning) so the first bytes are kept. */
export function readyPtyBus(): Promise<void> {
  return start();
}

/** Receive a session's output, replaying what came before; returns the unsubscribe. */
export function subscribePty(id: number, sub: Subscriber): () => void {
  void start().catch(() => {});
  subscribers.set(id, sub);
  const r = replays.get(id);
  if (r) {
    for (const chunk of r.chunks) sub.onData(chunk);
    if (r.exited) sub.onExit();
  }
  return () => {
    if (subscribers.get(id) === sub) subscribers.delete(id);
  };
}

/** The session is gone for good (pane closed or restarted): drop its replay. */
export function forgetPty(id: number): void {
  replays.delete(id);
  subscribers.delete(id);
}
