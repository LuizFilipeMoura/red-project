import { EVENTS, makeMsg, type GaSnapshot } from '@repo/shared';
import type { Namespace } from 'socket.io';
import { logger } from '../logger.js';

type SnapshotEntry = {
  snapshot: GaSnapshot;
  receivedAt: number;
  sid: string;
};

const monitorRoom = 'ga:monitor';

export class GaTelemetryStore {
  private byGeneration = new Map<number, SnapshotEntry>();
  private latest?: SnapshotEntry;

  set(snapshot: GaSnapshot, sid: string) {
    const entry: SnapshotEntry = { snapshot, receivedAt: Date.now(), sid };
    this.byGeneration.set(snapshot.gen, entry);
    if (!this.latest || snapshot.gen >= this.latest.snapshot.gen) {
      this.latest = entry;
    }
    logger.debug({ gen: snapshot.gen }, 'Updated GA snapshot');
  }

  getLatest(): SnapshotEntry | undefined {
    return this.latest;
  }

  getByGeneration(gen: number): SnapshotEntry | undefined {
    return this.byGeneration.get(gen);
  }

  getAllSnapshots(): GaSnapshot[] {
    return Array.from(this.byGeneration.values())
      .map((entry) => entry.snapshot)
      .sort((a, b) => b.gen - a.gen); // Most recent first
  }

  broadcastLatest(namespace: Namespace, targetSocketId?: string) {
    const entry = this.getLatest();
    if (!entry) {
      logger.debug('No latest snapshot to broadcast');
      return;
    }
    const payload = makeMsg(EVENTS.GA_UPDATE, {
      snapshot: entry.snapshot,
    });
    if (targetSocketId) {
      logger.debug(
        { gen: entry.snapshot.gen, targetSocketId },
        'Broadcasting GA snapshot to specific socket',
      );
      namespace.to(targetSocketId).emit(EVENTS.GA_UPDATE, payload);
    } else {
      logger.debug({ gen: entry.snapshot.gen, room: monitorRoom }, 'Broadcasting GA snapshot to monitor room');
      namespace.to(monitorRoom).emit(EVENTS.GA_UPDATE, payload);
    }
  }
}

export const gaTelemetryStore = new GaTelemetryStore();

export const GA_MONITOR_ROOM = monitorRoom;
