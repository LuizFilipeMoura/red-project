import { io, type Socket } from 'socket.io-client';
import { EVENTS, makeMsg, type GaSnapshot } from '@repo/shared';
import { env } from './env.js';
import { logger } from './logger.js';

export class TelemetryClient {
  private socket?: Socket;
  private connecting?: Promise<Socket>;

  private async ensureSocket() {
    if (this.socket) {
      return this.socket;
    }
    if (!this.connecting) {
      this.connecting = new Promise<Socket>((resolve, reject) => {
        logger.debug({ url: env.GA_SOCKET_URL }, 'Attempting to connect to telemetry socket');
        const socket = io(env.GA_SOCKET_URL, {
          transports: ['websocket', 'polling'],
          withCredentials: true,
        });
        socket.on('connect', () => {
          logger.info({ id: socket.id, url: env.GA_SOCKET_URL }, 'Telemetry socket connected');
          this.socket = socket;
          resolve(socket);
        });
        socket.on('connect_error', (error) => {
          logger.error({ err: error, url: env.GA_SOCKET_URL }, 'Telemetry socket connection error');
        });
        socket.on('error', (error) => {
          logger.error({ err: error }, 'Telemetry socket error');
          this.socket = undefined;
          this.connecting = undefined;
          reject(error);
        });
        socket.on('disconnect', (reason) => {
          logger.warn({ reason }, 'Telemetry socket disconnected');
          this.socket = undefined;
          this.connecting = undefined;
        });
      });
    }
    return this.connecting;
  }

  async sendSnapshot(snapshot: GaSnapshot) {
    const socket = await this.ensureSocket();
    logger.debug(
      {
        gen: snapshot.gen,
        socketId: socket.id,
        connected: socket.connected,
        event: EVENTS.GA_UPDATE,
      },
      'Emitting GA snapshot to socket',
    );
    socket.emit(
      EVENTS.GA_UPDATE,
      makeMsg(EVENTS.GA_UPDATE, {
        token: env.GA_EMITTER_TOKEN,
        snapshot,
      }),
    );
    logger.debug({ gen: snapshot.gen }, 'GA snapshot emitted');
  }
}

export const telemetryClient = new TelemetryClient();
