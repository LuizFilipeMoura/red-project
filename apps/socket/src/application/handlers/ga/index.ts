import {
  EVENTS,
  gaMonitorJoinSchema,
  gaReplayRequestSchema,
  gaUpdateRequestSchema,
  makeMsg,
  type GaReplayRequestPayload,
  type GaUpdateRequestPayload,
} from '@repo/shared';
import { ApplicationError } from '../../errors.js';
import type { HandlerDefinition } from '../../registry.js';
import { env } from '../../../env.js';
import { gaTelemetryStore, GA_MONITOR_ROOM } from '../../../ga/telemetryStore.js';
import { failReplay, startReplayFromTrace } from '../../../ga/replayManager.js';

const lastUpdateTimestamps = new Map<string, number>();

const enforceEmitterToken = (token: string | undefined) => {
  if (env.GA_EMITTER_TOKEN && env.GA_EMITTER_TOKEN.length > 0) {
    if (!token || token !== env.GA_EMITTER_TOKEN) {
      throw new ApplicationError('UNAUTHORIZED', 'Invalid GA emitter token');
    }
  }
};

const enforceMonitorToken = (token: string | undefined) => {
  if (env.GA_MONITOR_TOKEN && env.GA_MONITOR_TOKEN.length > 0) {
    if (!token || token !== env.GA_MONITOR_TOKEN) {
      throw new ApplicationError('UNAUTHORIZED', 'Invalid GA monitor token');
    }
  }
};

const monitorJoinDefinition: HandlerDefinition = {
  event: EVENTS.GA_MONITOR_JOIN,
  schema: gaMonitorJoinSchema,
  handler: async (context, input) => {
    enforceMonitorToken(input.token);
    await context.socket.join(GA_MONITOR_ROOM);
    const latest = gaTelemetryStore.getLatest();
    if (latest) {
      context.socket.emit(
        EVENTS.GA_UPDATE,
        makeMsg(EVENTS.GA_UPDATE, { snapshot: latest.snapshot }),
      );
    }
  },
};

const gaUpdateDefinition: HandlerDefinition = {
  event: EVENTS.GA_UPDATE,
  schema: gaUpdateRequestSchema,
  handler: async (context, input: GaUpdateRequestPayload) => {
    enforceEmitterToken(input.token);
    const now = Date.now();
    const last = lastUpdateTimestamps.get(context.sid) ?? 0;
    if (now - last < env.GA_UPDATE_THROTTLE_MS) {
      return;
    }
    lastUpdateTimestamps.set(context.sid, now);

    const size = Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8');
    if (size > env.GA_UPDATE_MAX_BYTES) {
      throw new ApplicationError('PAYLOAD_TOO_LARGE', 'GA update payload too large');
    }

    gaTelemetryStore.set(input.snapshot, context.sid);
    gaTelemetryStore.broadcastLatest(context.socket.nsp);
  },
};

const gaReplayRequestDefinition: HandlerDefinition = {
  event: EVENTS.GA_REPLAY_REQUEST,
  schema: gaReplayRequestSchema,
  handler: async (context, input: GaReplayRequestPayload) => {
    if (env.GA_MONITOR_TOKEN && !context.socket.rooms.has(GA_MONITOR_ROOM)) {
      throw new ApplicationError('UNAUTHORIZED', 'Monitor access required');
    }
    const entry = gaTelemetryStore.getByGeneration(input.gen);
    if (!entry) {
      throw new ApplicationError('NOT_FOUND', 'Generation snapshot not available');
    }
    const speed = input.speed ?? 1;
    const episode = entry.snapshot.bestEpisode ?? entry.snapshot.episodes[0];
    if (!episode) {
      throw new ApplicationError('NOT_FOUND', 'Episode summary missing');
    }

    if (episode.engineVersion !== env.GA_ENGINE_VERSION) {
      context.logger.warn(
        {
          gen: episode.gen,
          snapshotVersion: episode.engineVersion,
          serverVersion: env.GA_ENGINE_VERSION,
        },
        'Engine version mismatch; replaying from trace',
      );
    }

    try {
      await startReplayFromTrace(context.socket.nsp, episode, speed);
    } catch (error) {
      failReplay(context.socket.nsp, episode.gen, error);
      throw new ApplicationError('REPLAY_FAILED', 'Failed to start replay');
    }
  },
};

export const gaHandlerDefinitions: HandlerDefinition[] = [
  monitorJoinDefinition,
  gaUpdateDefinition,
  gaReplayRequestDefinition,
];
