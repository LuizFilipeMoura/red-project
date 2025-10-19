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

    // Send all historical snapshots to the newly joined monitor
    const allSnapshots = gaTelemetryStore.getAllSnapshots();
    context.logger.info(
      { snapshotCount: allSnapshots.length, socketId: context.socket.id },
      'Monitor joined, sending historical snapshots',
    );

    for (const snapshot of allSnapshots) {
      context.socket.emit(
        EVENTS.GA_UPDATE,
        makeMsg(EVENTS.GA_UPDATE, { snapshot }),
      );
    }

    if (allSnapshots.length === 0) {
      context.logger.info('No historical snapshots available for new monitor');
    }
  },
};

const gaUpdateDefinition: HandlerDefinition = {
  event: EVENTS.GA_UPDATE,
  schema: gaUpdateRequestSchema,
  handler: async (context, input: GaUpdateRequestPayload) => {
    context.logger.debug(
      {
        gen: input.snapshot.gen,
        sid: context.sid,
        hasToken: !!input.token,
      },
      'Received GA_UPDATE event',
    );
    enforceEmitterToken(input.token);
    const now = Date.now();
    const last = lastUpdateTimestamps.get(context.sid) ?? 0;
    if (now - last < env.GA_UPDATE_THROTTLE_MS) {
      context.logger.debug(
        { gen: input.snapshot.gen, throttleMs: env.GA_UPDATE_THROTTLE_MS },
        'GA update throttled',
      );
      return;
    }
    lastUpdateTimestamps.set(context.sid, now);

    const size = Buffer.byteLength(JSON.stringify(input.snapshot), 'utf8');
    if (size > env.GA_UPDATE_MAX_BYTES) {
      throw new ApplicationError('PAYLOAD_TOO_LARGE', 'GA update payload too large');
    }

    gaTelemetryStore.set(input.snapshot, context.sid);
    context.logger.info(
      { gen: input.snapshot.gen, fitness: input.snapshot.best.fitness },
      'GA snapshot stored, broadcasting to monitors',
    );
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
