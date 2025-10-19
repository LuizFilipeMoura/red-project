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
        const socket = io(env.GA_SOCKET_URL, {
          transports: ['websocket', 'polling'],
          withCredentials: true,
        });
        socket.on('connect', () => {
          logger.info({ id: socket.id }, 'Telemetry socket connected');
          this.socket = socket;
          resolve(socket);
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
    socket.emit(
      EVENTS.GA_UPDATE,
      makeMsg(EVENTS.GA_UPDATE, {
        token: env.GA_EMITTER_TOKEN,
        snapshot,
      }),
    );
  }
}

export const telemetryClient = new TelemetryClient();
