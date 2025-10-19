import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Namespace } from 'socket.io';
import {
  EVENTS,
  makeMsg,
  type GaEpisodeSummary,
  type GaReplayFramePayload,
} from '@repo/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';

type ReplayFrame = Pick<GaReplayFramePayload, 'frame' | 'timestamp' | 'match' | 'action'>;

type ActiveReplay = {
  gen: number;
  episode: GaEpisodeSummary;
  frames: ReplayFrame[];
  timer?: NodeJS.Timeout;
  speed: number;
  currentIndex: number;
};

const monitorRoom = 'ga:monitor';
const activeReplays = new Map<number, ActiveReplay>();

const resolveTracePath = (traceRef: string) => {
  if (path.isAbsolute(traceRef)) return traceRef;
  return path.resolve(env.GA_DATA_DIR, traceRef);
};

const loadFramesFromTrace = async (traceRef: string) => {
  const tracePath = resolveTracePath(traceRef);
  const raw = await readFile(tracePath, 'utf8');
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const frames: ReplayFrame[] = lines.map((line, index) => {
    const parsed = JSON.parse(line) as Partial<GaReplayFramePayload>;
    return {
      frame: parsed.frame ?? index,
      timestamp: parsed.timestamp ?? Date.now(),
      match: parsed.match ?? null,
      action: parsed.action,
    } satisfies ReplayFrame;
  });
  return frames;
};

const stopReplay = (namespace: Namespace, gen: number, reason: 'completed' | 'cancelled' | 'error', message?: string) => {
  const existing = activeReplays.get(gen);
  if (!existing) return;
  if (existing.timer) {
    clearInterval(existing.timer);
  }
  activeReplays.delete(gen);
  namespace
    .to(monitorRoom)
    .emit(EVENTS.GA_REPLAY_END, makeMsg(EVENTS.GA_REPLAY_END, { gen, reason, message }));
};

export const startReplayFromTrace = async (
  namespace: Namespace,
  episode: GaEpisodeSummary,
  speed: number,
) => {
  if (!episode.traceRef) {
    throw new Error('No trace available for episode');
  }
  if (activeReplays.size >= env.GA_REPLAY_MAX_PARALLEL) {
    throw new Error('Replay capacity exceeded');
  }
  if (activeReplays.has(episode.gen)) {
    stopReplay(namespace, episode.gen, 'cancelled', 'Restarting replay');
  }
  const frames = await loadFramesFromTrace(episode.traceRef);
  const interval = Math.max(50, Math.round(env.GA_REPLAY_FRAME_INTERVAL_MS / Math.max(speed, 0.25)));
  const state: ActiveReplay = {
    gen: episode.gen,
    episode,
    frames,
    speed,
    currentIndex: 0,
  };
  activeReplays.set(episode.gen, state);
  namespace.to(monitorRoom).emit(
    EVENTS.GA_REPLAY_START,
    makeMsg(EVENTS.GA_REPLAY_START, {
      gen: episode.gen,
      seed: episode.seed,
      weightsHash: episode.weightsHash,
      policyVersion: episode.policyVersion,
      engineVersion: episode.engineVersion,
      totalFrames: frames.length,
      playbackSpeed: speed,
    }),
  );

  if (frames.length === 0) {
    stopReplay(namespace, episode.gen, 'completed');
    return;
  }

  state.timer = setInterval(() => {
    const current = activeReplays.get(episode.gen);
    if (!current) return;
    const frame = current.frames[current.currentIndex];
    if (!frame) {
      stopReplay(namespace, episode.gen, 'completed');
      return;
    }
    namespace
      .to(monitorRoom)
      .emit(EVENTS.GA_REPLAY_FRAME, makeMsg(EVENTS.GA_REPLAY_FRAME, { gen: episode.gen, ...frame }));
    current.currentIndex += 1;
    if (current.currentIndex >= current.frames.length) {
      stopReplay(namespace, episode.gen, 'completed');
    }
  }, interval);

  logger.info(
    { gen: episode.gen, frames: frames.length, interval, speed },
    'Started GA replay from trace',
  );
};

export const cancelReplay = (namespace: Namespace, gen: number, message?: string) => {
  stopReplay(namespace, gen, 'cancelled', message);
};

export const failReplay = (namespace: Namespace, gen: number, error: unknown) => {
  const reason = error instanceof Error ? error.message : 'Unknown replay error';
  logger.error({ err: error, gen }, 'GA replay failed');
  stopReplay(namespace, gen, 'error', reason);
};
