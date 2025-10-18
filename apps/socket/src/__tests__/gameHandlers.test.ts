import { jest } from '@jest/globals';
import { EVENTS, MANA_PER_TURN } from '@repo/shared';
import { handlePlaceUnit, preProcessPlaceUnit } from '../application/handlers/game/placeUnit.js';
import { handleMoveUnit, preProcessMoveUnit } from '../application/handlers/game/moveUnit.js';
import { handleEndTurn, preProcessEndTurn } from '../application/handlers/game/endTurn.js';
import { ApplicationError } from '../application/errors.js';
import {
  createLobbyRow,
  initializeMatchState,
  type LobbyState,
  type PlayerState,
} from '../state.js';
import type { HandlerContext } from '../application/types.js';

const makeMutex = () => {
  let locked = false;
  const queue: (() => void)[] = [];

  const acquire = async () =>
    new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (!locked) {
          locked = true;
          resolve(() => {
            locked = false;
            const next = queue.shift();
            if (next) {
              next();
            }
          });
        } else {
          queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });

  return {
    acquire,
    runExclusive: async <T>(fn: () => Promise<T> | T) => {
      const release = await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
};

const createLobbyState = (id = 'lobby-1') => {
  const playerA = 'player-a';
  const playerB = 'player-b';
  const meta = createLobbyRow({ id, name: 'Test Lobby', ownerSid: playerA });
  const players: PlayerState[] = [
    { lobbyId: id, sid: playerA, joinedAt: Date.now(), isReady: true },
    { lobbyId: id, sid: playerB, joinedAt: Date.now() + 1, isReady: true },
  ];
  const lobby: LobbyState = {
    meta,
    players,
    currentPlayerSid: playerA,
    turnNumber: 1,
    deadlineAt: null,
    match: null,
    mutex: makeMutex() as any,
  };
  lobby.match = initializeMatchState(lobby, [playerA, playerB]);
  lobby.match.mana[playerA] = MANA_PER_TURN;
  lobby.match.mana[playerB] = 0;
  return lobby;
};

const createContext = (lobby: LobbyState, sid: string): HandlerContext => ({
  db: {} as any,
  store: new Map([[lobby.meta.id, lobby]]),
  socket: {} as any,
  sid,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
  emitError: jest.fn(),
  joinLobbyRoom: jest.fn(),
  leaveLobbyRoom: jest.fn(),
  broadcastState: jest.fn(),
  scheduleTurnTimeout: jest.fn(),
  clearLobbyTimeout: jest.fn(),
  checkRateLimit: () => true,
  parsePayload: (_event, payload, schema) => schema.parse(payload),
});

describe('game:placeUnit', () => {
  it('throws when mana is insufficient', async () => {
    const lobby = createLobbyState();
    lobby.match!.mana[lobby.currentPlayerSid!] = 1;
    const context = createContext(lobby, lobby.currentPlayerSid!);
    await expect(
      preProcessPlaceUnit(context, {
        lobbyId: lobby.meta.id,
        type: 'Mage',
        x: 0,
        y: 0,
      }),
    ).rejects.toMatchObject({ code: 'NOT_ENOUGH_MANA' } as Partial<ApplicationError>);
  });

  it('places a unit and updates mana', async () => {
    const lobby = createLobbyState();
    const context = createContext(lobby, lobby.currentPlayerSid!);
    const payload = { lobbyId: lobby.meta.id, type: 'Warrior', x: 0, y: 0 } as const;
    await preProcessPlaceUnit(context, payload);
    await handlePlaceUnit(context, payload);
    expect(lobby.match!.units).toHaveLength(1);
    expect(lobby.match!.units[0]).toMatchObject({
      owner: lobby.currentPlayerSid!,
      x: 0,
      y: 0,
      type: 'Warrior',
    });
    expect(lobby.match!.mana[lobby.currentPlayerSid!]).toBe(MANA_PER_TURN - 2);
    expect(context.broadcastState).toHaveBeenCalledWith(lobby, {
      type: EVENTS.GAME_PLACE_UNIT,
      payload,
    });
  });
});

describe('game:moveUnit', () => {
  it('prevents moving before unit is ready', async () => {
    const lobby = createLobbyState();
    const unit = {
      id: 'u1',
      type: 'Warrior' as const,
      owner: lobby.currentPlayerSid!,
      x: 0,
      y: 0,
      canMoveAtTurn: lobby.match!.turnNumber + 1,
    };
    lobby.match!.units.push(unit);
    const context = createContext(lobby, lobby.currentPlayerSid!);
    await expect(
      preProcessMoveUnit(context, {
        lobbyId: lobby.meta.id,
        unitId: unit.id,
        toX: 1,
        toY: 0,
      }),
    ).rejects.toMatchObject({ code: 'UNIT_NOT_READY' } as Partial<ApplicationError>);
  });

  it('moves a unit and detects victory on enemy flag', async () => {
    const lobby = createLobbyState();
    const unit = {
      id: 'u2',
      type: 'Warrior' as const,
      owner: lobby.currentPlayerSid!,
      x: 6,
      y: 7,
      canMoveAtTurn: lobby.match!.turnNumber,
    };
    lobby.match!.units.push(unit);
    const context = createContext(lobby, lobby.currentPlayerSid!);
    const payload = { lobbyId: lobby.meta.id, unitId: unit.id, toX: 7, toY: 7 };
    await preProcessMoveUnit(context, payload);
    await handleMoveUnit(context, payload);
    expect(unit).toMatchObject({ x: 7, y: 7 });
    expect(lobby.match!.winnerSid).toBe(lobby.currentPlayerSid);
    expect(context.broadcastState).toHaveBeenCalledWith(lobby, {
      type: EVENTS.GAME_MOVE_UNIT,
      payload,
    });
  });
});

describe('game:endTurn', () => {
  it('switches active player and refreshes mana', async () => {
    const lobby = createLobbyState();
    const context = createContext(lobby, lobby.currentPlayerSid!);
    const payload = { lobbyId: lobby.meta.id } as const;
    await preProcessEndTurn(context, payload);
    await handleEndTurn(context, payload);
    expect(lobby.match!.currentPlayerSid).not.toBe(context.sid);
    expect(lobby.match!.turnNumber).toBe(2);
    const nextPlayer = lobby.match!.currentPlayerSid!;
    expect(lobby.match!.mana[nextPlayer]).toBe(MANA_PER_TURN);
    expect(lobby.match!.mana[context.sid]).toBe(0);
    expect(context.broadcastState).toHaveBeenCalledWith(lobby, {
      type: EVENTS.GAME_END_TURN,
      payload: { lobbyId: lobby.meta.id },
    });
  });

  it('rejects when not current player', async () => {
    const lobby = createLobbyState();
    const context = createContext(lobby, 'player-b');
    await expect(preProcessEndTurn(context, { lobbyId: lobby.meta.id })).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    } as Partial<ApplicationError>);
  });
});
