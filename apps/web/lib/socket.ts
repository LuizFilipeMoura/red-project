'use client';

import { io, type Socket } from 'socket.io-client';
import { z } from 'zod';
import {
  EVENTS,
  makeMsg,
  schemas,
  requestSchemas,
  type Lobby,
  type LobbyListPayload,
  type ErrorPayload,
  type StateSync,
  type MoveUnitPayload,
  type EndTurnPayload,
  type PlayUnitCardPayload,
  type PlaySpellCardPayload,
  type PlayTalentCardPayload,
  type GaUpdatePayload,
  type GaReplayStartPayload,
  type GaReplayFramePayload,
  type GaReplayEndPayload,
} from '@repo/shared';

const SOCKET_URL = `${process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000'}/game`;

type EventKey = keyof typeof schemas;
type EventValue = (typeof EVENTS)[keyof typeof EVENTS];

const isEventKey = (value: string): value is EventKey => value in schemas;

class SocketManager {
  private socket?: Socket;
  private handlers: Partial<Record<EventKey, Set<(payload: any) => void>>> = {};

  private ensureSocket() {
    if (this.socket || typeof window === 'undefined') {
      return this.socket;
    }
    this.socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    this.socket.onAny((event, message) => {
      if (!isEventKey(event)) return;
      try {
        const schema = schemas[event];
        console.log('Raw socket message:', event, message);
        const payload = this.parseMessage(event, message, schema as z.ZodTypeAny);
        console.log('Parsed payload:', event, payload);

        // Log full game state on state sync
        if (event === 'state:sync') {
          console.log('🎮 STATE SYNC - Full game state:', JSON.stringify(payload, null, 2));
        }

        this.handlers[event]?.forEach((handler) => handler(payload));
      } catch (error) {
        console.error('Socket payload parse failed', event, error);
      }
    });
    return this.socket;
  }

  private parseMessage<T>(event: EventKey, message: unknown, schema: z.ZodType<T>): T {
    if (message && typeof message === 'object' && 'payload' in (message as any)) {
      const typed = message as { version: string; type: string; payload: unknown };
      if (typed.type !== event) {
        throw new Error(`Unexpected type ${typed.type}`);
      }
      return schema.parse(typed.payload);
    }
    return schema.parse(message);
  }

  emit<T>(event: EventValue, payload: unknown) {
    const socket = this.ensureSocket();
    if (!socket) return;
    if (!isEventKey(event)) {
      throw new Error(`Unknown event ${event}`);
    }
    // Use requestSchemas for outgoing messages
    const requestSchema = (requestSchemas as any)[event];
    const data = requestSchema ? requestSchema.parse(payload) : payload;
    socket.emit(event, makeMsg(event, data as never));
  }

  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  on<T>(event: EventValue, handler: (payload: T) => void) {
    if (!isEventKey(event)) return () => undefined;
    this.ensureSocket();
    if (!this.handlers[event]) {
      this.handlers[event] = new Set();
    }
    const set = this.handlers[event]!;
    set.add(handler as any);
    return () => {
      set.delete(handler as any);
    };
  }
}

export const socketClient = new SocketManager();

export type LobbyListHandler = (payload: LobbyListPayload) => void;
export type StateSyncHandler = (payload: StateSync) => void;
export type ErrorHandler = (payload: ErrorPayload) => void;
export type GaUpdateHandler = (payload: GaUpdatePayload['snapshot']) => void;
export type GaReplayStartHandler = (payload: GaReplayStartPayload) => void;
export type GaReplayFrameHandler = (payload: GaReplayFramePayload) => void;
export type GaReplayEndHandler = (payload: GaReplayEndPayload) => void;

export function requestLobbyList(page = 1, pageSize = 10) {
  socketClient.emit(EVENTS.LIST, { page, pageSize });
}

export function createLobby(data: { name: string; password?: string }) {
  socketClient.emit(EVENTS.CREATE, data);
}

export function joinLobby(lobbyId: string, password?: string) {
  socketClient.emit(EVENTS.JOIN, { lobbyId, password });
}

export function leaveLobby(lobbyId: string) {
  socketClient.emit(EVENTS.LEAVE, { lobbyId });
}

export function startLobby(lobbyId: string) {
  socketClient.emit(EVENTS.START, { lobbyId });
}

export function moveUnit(payload: MoveUnitPayload) {
  socketClient.emit(EVENTS.GAME_MOVE_UNIT, payload);
}

export function endTurn(payload: EndTurnPayload) {
  socketClient.emit(EVENTS.GAME_END_TURN, payload);
}

export function playUnitCard(payload: PlayUnitCardPayload) {
  socketClient.emit(EVENTS.CARD_PLAY_UNIT, payload);
}

export function playSpellCard(payload: PlaySpellCardPayload) {
  socketClient.emit(EVENTS.CARD_PLAY_SPELL, payload);
}

export function playTalentCard(payload: PlayTalentCardPayload) {
  socketClient.emit(EVENTS.CARD_PLAY_TALENT, payload);
}

export function joinGaMonitor(token?: string) {
  socketClient.emit(EVENTS.GA_MONITOR_JOIN, { token });
}

export function requestGaReplay(gen: number, speed?: number) {
  socketClient.emit(EVENTS.GA_REPLAY_REQUEST, { gen, speed });
}

export function onGaUpdate(handler: GaUpdateHandler) {
  return socketClient.on(EVENTS.GA_UPDATE, (payload: GaUpdatePayload) => handler(payload.snapshot));
}

export function onGaReplayStart(handler: GaReplayStartHandler) {
  return socketClient.on(EVENTS.GA_REPLAY_START, handler);
}

export function onGaReplayFrame(handler: GaReplayFrameHandler) {
  return socketClient.on(EVENTS.GA_REPLAY_FRAME, handler);
}

export function onGaReplayEnd(handler: GaReplayEndHandler) {
  return socketClient.on(EVENTS.GA_REPLAY_END, handler);
}

export type LobbyState = Lobby;
