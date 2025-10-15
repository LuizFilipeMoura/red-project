import { Mutex } from 'async-mutex';
import { nanoid } from 'nanoid';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Lobby, Player } from '@repo/shared';
import {
  LOBBY_CAPACITY,
  TURN_TIMEOUT_MS,
  VERSION,
} from '@repo/shared';
import { lobbies, turns } from '@repo/db';
import type { InferModel } from 'drizzle-orm';

export type LobbyRow = InferModel<typeof lobbies>;

export type PlayerState = {
  id?: number | null;
  lobbyId: string;
  sid: string;
  joinedAt: number;
  isReady: boolean;
};

export type LobbyState = {
  meta: LobbyRow;
  players: PlayerState[];
  currentPlayerSid: string | null;
  turnNumber: number;
  deadlineAt: number | null;
  mutex: Mutex;
  timeout?: NodeJS.Timeout;
};

export type LobbyStore = Map<string, LobbyState>;

export const createLobbyStore = (): LobbyStore => new Map();

export const toLobby = (state: LobbyState): Lobby => ({
  id: state.meta.id,
  name: state.meta.name,
  isPrivate: Boolean(state.meta.isPrivate),
  players: state.players.map<Player>((player) => ({
    sid: player.sid,
    joinedAt: new Date(player.joinedAt ?? Date.now()).toISOString(),
    isReady: Boolean(player.isReady),
  })),
  capacity: LOBBY_CAPACITY,
  createdAt: new Date(state.meta.createdAt ?? Date.now()).toISOString(),
  ownerSid: state.meta.ownerSid ?? undefined,
  status: state.meta.status as Lobby['status'],
  currentPlayerSid: state.currentPlayerSid ?? undefined,
  turnNumber: state.turnNumber,
  deadlineAt: state.deadlineAt ? new Date(state.deadlineAt).toISOString() : null,
});

export const sanitizeName = (name: string) => name.replace(/[^\w\s-]/g, '').trim();

export const createLobbyRow = (
  partial: Partial<LobbyRow> & { name: string; ownerSid: string },
): LobbyRow => ({
  id: partial.id ?? nanoid(),
  name: sanitizeName(partial.name),
  isPrivate: partial.isPrivate ?? false,
  passwordHash: partial.passwordHash ?? null,
  capacity: partial.capacity ?? LOBBY_CAPACITY,
  ownerSid: partial.ownerSid,
  createdAt: partial.createdAt ?? Date.now(),
  status: partial.status ?? 'waiting',
});

export const toStateSnapshot = (state: LobbyState) => ({
  lobby: toLobby(state),
  version: VERSION,
});

export const persistSnapshot = async (
  db: BetterSQLite3Database,
  state: LobbyState,
) => {
  const snapshot = JSON.stringify(toStateSnapshot(state));
  await db
    .insert(turns)
    .values({
      lobbyId: state.meta.id,
      stateJson: snapshot,
      currentPlayerSid: state.currentPlayerSid ?? null,
      turnNumber: state.turnNumber,
      deadlineAt: state.deadlineAt,
    })
    .run();
};

export const removeEmptyLobbies = (
  store: LobbyStore,
  now = Date.now(),
  retentionMs = 5 * 60 * 1000,
) => {
  for (const [id, lobby] of store) {
    if (lobby.players.length === 0) {
      const lastTurn = lobby.deadlineAt ?? lobby.meta.createdAt ?? now;
      if (now - lastTurn > retentionMs) {
        store.delete(id);
      }
    }
  }
};

export const attachTimeout = (
  store: LobbyStore,
  lobbyId: string,
  onTimeout: (state: LobbyState) => void,
  duration = TURN_TIMEOUT_MS,
) => {
  const lobby = store.get(lobbyId);
  if (!lobby) return;
  if (lobby.timeout) {
    clearTimeout(lobby.timeout);
  }
  if (!lobby.currentPlayerSid) return;
  const timeoutDuration = Math.max(duration, 0);
  lobby.deadlineAt = Date.now() + timeoutDuration;
  lobby.timeout = setTimeout(() => onTimeout(lobby), timeoutDuration);
};

export const clearLobbyTimeout = (store: LobbyStore, lobbyId: string) => {
  const lobby = store.get(lobbyId);
  if (lobby?.timeout) {
    clearTimeout(lobby.timeout);
    lobby.timeout = undefined;
  }
};
