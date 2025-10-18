import { Mutex } from 'async-mutex';
import { nanoid } from 'nanoid';
import type { InferSelectModel } from 'drizzle-orm';
import { asc, eq } from 'drizzle-orm';
import type { DbClient } from './application/types.js';
import { actionsLog, lobbies, matches, players, units } from '@repo/db';
import type { Lobby, MatchState, Player } from '@repo/shared';
import { BOARD_W, FLAG_A, FLAG_B, LOBBY_CAPACITY, MANA_PER_TURN } from '@repo/shared';

export type LobbyRow = InferSelectModel<typeof lobbies>;
export type PlayerRow = InferSelectModel<typeof players>;

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
  match: MatchState | null;
  mutex: Mutex;
  timeout?: NodeJS.Timeout;
};

export type LobbyStore = Map<string, LobbyState>;

export const createLobbyStore = (): LobbyStore => new Map();

const toPlayer = (player: PlayerState): Player => ({
  sid: player.sid,
  joinedAt: new Date(player.joinedAt ?? Date.now()).toISOString(),
  isReady: Boolean(player.isReady),
});

export const toLobby = (state: LobbyState): Lobby => ({
  id: state.meta.id,
  name: state.meta.name,
  isPrivate: Boolean(state.meta.isPrivate),
  players: state.players.map(toPlayer),
  capacity: state.meta.capacity,
  createdAt: new Date(state.meta.createdAt).toISOString(),
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
  match: state.match,
  version: '1.0.0',
});

export const persistSnapshot = async (
  db: DbClient,
  state: LobbyState,
  action?: { type: string; payload: unknown },
) => {
  const snapshot = JSON.stringify(toStateSnapshot(state));
  if (state.match) {
    const baseMatch = {
      id: state.meta.id,
      currentPlayerSid: state.match.currentPlayerSid,
      turnNumber: state.match.turnNumber,
      stateJson: snapshot,
      updatedAt: Date.now(),
    } satisfies InferSelectModel<typeof matches>;

    await db
      .insert(matches)
      .values(baseMatch)
      .onConflictDoUpdate({
        target: matches.id,
        set: {
          currentPlayerSid: baseMatch.currentPlayerSid,
          turnNumber: baseMatch.turnNumber,
          stateJson: baseMatch.stateJson,
          updatedAt: baseMatch.updatedAt,
        },
      });

    await db.delete(units).where(eq(units.matchId, state.meta.id));
    if (state.match.units.length > 0) {
      await db.insert(units).values(
        state.match.units.map((unit) => ({
          id: unit.id,
          matchId: state.meta.id,
          type: unit.type,
          ownerSid: unit.owner,
          x: unit.x,
          y: unit.y,
          canMoveAtTurn: unit.canMoveAtTurn,
        })),
      );
    }

    if (action) {
      await db.insert(actionsLog).values({
        matchId: state.meta.id,
        type: action.type,
        payloadJson: JSON.stringify(action.payload),
        ts: Date.now(),
      });
    }
  }
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
  duration = 10_000,
) => {
  const lobby = store.get(lobbyId);
  if (!lobby) return;
  if (lobby.timeout) {
    clearTimeout(lobby.timeout);
  }
  if (!lobby.currentPlayerSid) return;
  const timeoutDuration = Math.max(duration, 0);
  lobby.deadlineAt = Date.now() + timeoutDuration;
};

export const clearLobbyTimeout = (store: LobbyStore, lobbyId: string) => {
  const lobby = store.get(lobbyId);
  if (lobby?.timeout) {
    clearTimeout(lobby.timeout);
    lobby.timeout = undefined;
  }
};

export const loadMatchState = async (db: DbClient, lobby: LobbyState) => {
  const [matchRow] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, lobby.meta.id))
    .limit(1);
  if (!matchRow) {
    lobby.match = null;
    return;
  }
  const unitRows = await db.select().from(units).where(eq(units.matchId, lobby.meta.id));
  const parsed = JSON.parse(matchRow.stateJson) as { match?: MatchState };
  const baseMatch: MatchState = parsed.match ?? {
    lobbyId: lobby.meta.id,
    board: { width: BOARD_W, height: BOARD_H, flagA: FLAG_A, flagB: FLAG_B },
    units: unitRows.map((unit) => ({
      id: unit.id,
      type: unit.type as MatchState['units'][number]['type'],
      owner: unit.ownerSid,
      x: unit.x,
      y: unit.y,
      canMoveAtTurn: unit.canMoveAtTurn,
    })),
    currentPlayerSid: matchRow.currentPlayerSid,
    turnNumber: matchRow.turnNumber,
    mana: {},
    winnerSid: null,
  };
  baseMatch.units = unitRows.map((unit) => ({
    id: unit.id,
    type: unit.type as MatchState['units'][number]['type'],
    owner: unit.ownerSid,
    x: unit.x,
    y: unit.y,
    canMoveAtTurn: unit.canMoveAtTurn,
  }));
  lobby.match = baseMatch;
  lobby.currentPlayerSid = baseMatch.currentPlayerSid;
  lobby.turnNumber = baseMatch.turnNumber;
};

export const hydrateLobbies = async (db: DbClient, store: LobbyStore) => {
  const lobbyRows = await db.select().from(lobbies);
  for (const meta of lobbyRows) {
    const playerRows = await db
      .select()
      .from(players)
      .where(eq(players.lobbyId, meta.id))
      .orderBy(asc(players.joinedAt));

    const lobby: LobbyState = {
      meta,
      players: playerRows.map((row) => ({
        id: row.id,
        lobbyId: row.lobbyId,
        sid: row.sid,
        joinedAt: row.joinedAt,
        isReady: Boolean(row.isReady),
      })),
      currentPlayerSid: null,
      turnNumber: 0,
      deadlineAt: null,
      match: null,
      mutex: new Mutex(),
    };

    await loadMatchState(db, lobby);
    store.set(meta.id, lobby);
  }
};

export const initializeMatchState = (
  lobby: LobbyState,
  playerOrder: [string, string],
): MatchState => ({
  lobbyId: lobby.meta.id,
  board: { width: BOARD_W, height: BOARD_H, flagA: FLAG_A, flagB: FLAG_B },
  units: [],
  currentPlayerSid: playerOrder[0],
  turnNumber: 1,
  mana: {
    [playerOrder[0]]: MANA_PER_TURN,
    [playerOrder[1]]: 0,
  },
  winnerSid: null,
});
