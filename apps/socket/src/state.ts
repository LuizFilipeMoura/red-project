import { Mutex } from 'async-mutex';
import { nanoid } from 'nanoid';
import type { PrismaClient } from '@repo/db';
import type { Lobby, MatchState, Player } from '@repo/shared';
import { BOARD_H, BOARD_W, FLAG_A, FLAG_B, LOBBY_CAPACITY } from '@repo/shared';

export type LobbyRow = {
  id: string;
  name: string;
  isPrivate: boolean;
  passwordHash: string | null;
  capacity: number;
  ownerSid: string | null;
  createdAt: number;
  status: string;
};

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
  createdAt:
    typeof partial.createdAt === 'number'
      ? partial.createdAt
      : partial.createdAt instanceof Date
        ? partial.createdAt.getTime()
        : Date.now(),
  status: partial.status ?? 'waiting',
});

export const toStateSnapshot = (state: LobbyState) => ({
  lobby: toLobby(state),
  match: state.match,
  version: '1.0.0',
});

export const persistSnapshot = async (
  db: PrismaClient,
  state: LobbyState,
  action?: { type: string; payload: unknown },
) => {
  const snapshot = JSON.stringify(toStateSnapshot(state));
  if (!state.match) return;

  const now = new Date();

  const decksJson = JSON.stringify(state.match.decks);
  const cardsJson = JSON.stringify(state.match.cards);
  const talentsJson = JSON.stringify(state.match.talentsInHand);

  await db.match.upsert({
    where: { id: state.meta.id },
    create: {
      id: state.meta.id,
      currentPlayerSid: state.match.currentPlayerSid,
      turnNumber: state.match.turnNumber,
      stateJson: snapshot,
      decksJson,
      cardsJson,
      talentsJson,
      updatedAt: now,
    },
    update: {
      currentPlayerSid: state.match.currentPlayerSid,
      turnNumber: state.match.turnNumber,
      stateJson: snapshot,
      decksJson,
      cardsJson,
      talentsJson,
      updatedAt: now,
    },
  });

  await db.unit.deleteMany({ where: { matchId: state.meta.id } });
  if (state.match.units.length > 0) {
    await db.unit.createMany({
      data: state.match.units.map((unit) => ({
        id: unit.id,
        matchId: state.meta.id,
        type: unit.type,
        ownerSid: unit.owner,
        x: unit.x,
        y: unit.y,
        canMoveAtTurn: unit.canMoveAtTurn,
        hp: unit.hp,
        hpMax: unit.hpMax,
      })),
    });
  }

  if (action) {
    await db.actionLog.create({
      data: {
        matchId: state.meta.id,
        type: action.type,
        payloadJson: JSON.stringify(action.payload),
        ts: now,
      },
    });
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
  _onTimeout: (state: LobbyState) => void,
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

const withDefaultBoard = (match: MatchState | null, lobbyId: string): MatchState | null => {
  if (!match) return null;
  return {
    lobbyId,
    board: match.board ?? { width: BOARD_W, height: BOARD_H, flagA: FLAG_A, flagB: FLAG_B },
    units: match.units ?? [],
    currentPlayerSid: match.currentPlayerSid,
    turnNumber: match.turnNumber,
    mana: match.mana ?? {},
    decks: match.decks ?? {},
    cards: match.cards ?? {},
    talentsInHand: match.talentsInHand ?? {},
    winnerSid: match.winnerSid ?? null,
  };
};

export const loadMatchState = async (db: PrismaClient, lobby: LobbyState) => {
  const matchRow = await db.match.findUnique({ where: { id: lobby.meta.id } });
  if (!matchRow) {
    lobby.match = null;
    return;
  }

  const unitRows = await db.unit.findMany({ where: { matchId: lobby.meta.id } });
  const parsed = JSON.parse(matchRow.stateJson) as { match?: MatchState };
  const parsedDecks = JSON.parse(matchRow.decksJson ?? '{}') as MatchState['decks'];
  const parsedCards = JSON.parse(matchRow.cardsJson ?? '{}') as MatchState['cards'];
  const parsedTalents = JSON.parse(matchRow.talentsJson ?? '{}') as MatchState['talentsInHand'];

  const baseMatch = withDefaultBoard(
    parsed.match ?? {
      lobbyId: lobby.meta.id,
      board: { width: BOARD_W, height: BOARD_H, flagA: FLAG_A, flagB: FLAG_B },
      units: [],
      currentPlayerSid: matchRow.currentPlayerSid,
      turnNumber: matchRow.turnNumber,
      mana: {},
      decks: parsedDecks,
      cards: parsedCards,
      talentsInHand: parsedTalents,
      winnerSid: null,
    },
    lobby.meta.id,
  );

  if (!baseMatch) {
    lobby.match = null;
    return;
  }

  baseMatch.decks = parsedDecks;
  baseMatch.cards = parsedCards;
  baseMatch.talentsInHand = parsedTalents;

  baseMatch.units = unitRows.map((unit) => ({
    id: unit.id,
    type: unit.type as MatchState['units'][number]['type'],
    owner: unit.ownerSid,
    x: unit.x,
    y: unit.y,
    canMoveAtTurn: unit.canMoveAtTurn,
    hp: unit.hp,
    hpMax: unit.hpMax,
  }));

  lobby.match = baseMatch;
  lobby.currentPlayerSid = baseMatch.currentPlayerSid;
  lobby.turnNumber = baseMatch.turnNumber;
};

export const hydrateLobbies = async (db: PrismaClient, store: LobbyStore) => {
  const lobbyRows = await db.lobby.findMany();
  for (const meta of lobbyRows) {
    const playerRows = await db.player.findMany({
      where: { lobbyId: meta.id },
      orderBy: { joinedAt: 'asc' },
    });

    const lobby: LobbyState = {
      meta: {
        id: meta.id,
        name: meta.name,
        isPrivate: meta.isPrivate,
        passwordHash: meta.passwordHash ?? null,
        capacity: meta.capacity,
        ownerSid: meta.ownerSid ?? null,
        createdAt: meta.createdAt.getTime(),
        status: meta.status,
      },
      players: playerRows.map((row) => ({
        id: row.id,
        lobbyId: row.lobbyId,
        sid: row.sid,
        joinedAt: row.joinedAt.getTime(),
        isReady: row.isReady,
      })),
      currentPlayerSid: null,
      turnNumber: 0,
      deadlineAt: null,
      match: null,
      mutex: new Mutex(),
    };

    await loadMatchState(db, lobby);
    store.set(lobby.meta.id, lobby);
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
    [playerOrder[0]]: 0,
    [playerOrder[1]]: 0,
  },
  decks: {},
  cards: {},
  talentsInHand: { [playerOrder[0]]: [], [playerOrder[1]]: [] },
  winnerSid: null,
});
