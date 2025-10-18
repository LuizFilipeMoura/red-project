import { jest } from '@jest/globals';
import {
  EVENTS,
  MANA_PER_TURN,
  SIDE_ROWS,
  TALENT_RANGE,
  type Card_Spell,
  type Card_Talent,
  type Card_Unit,
} from '@repo/shared';
import { handlePlayUnit } from '../application/handlers/card/playUnit.js';
import { handlePlaySpell } from '../application/handlers/card/playSpell.js';
import { handlePlayTalent } from '../application/handlers/card/playTalent.js';
import { handleEndTurn, preProcessEndTurn } from '../application/handlers/game/endTurn.js';
import { ApplicationError } from '../application/errors.js';
import type { HandlerContext } from '../application/types.js';
import {
  createInitialDecks,
  generateTalentsForPlayer,
  startTurnForPlayer,
} from '../game/cards.js';
import {
  createLobbyRow,
  initializeMatchState,
  type LobbyState,
  type PlayerState,
} from '../state.js';

type DbMocks = {
  unit: {
    create: jest.Mock;
    deleteMany: jest.Mock;
    update: jest.Mock;
  };
};

const createDbMocks = (): DbMocks => ({
  unit: {
    create: jest.fn().mockResolvedValue(undefined),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
  },
});

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
  const { cards, decks } = createInitialDecks([playerA, playerB]);
  lobby.match.cards = cards;
  lobby.match.decks = decks;
  lobby.match.talentsInHand = { [playerA]: [], [playerB]: [] };
  lobby.match.mana[playerA] = 0;
  lobby.match.mana[playerB] = 0;
  startTurnForPlayer(lobby.match, playerA);
  lobby.currentPlayerSid = playerA;
  lobby.turnNumber = lobby.match.turnNumber;
  return lobby;
};

const createContext = (lobby: LobbyState, sid: string, db: DbMocks): HandlerContext => ({
  db: { ...db, lobby: { update: jest.fn() }, match: { upsert: jest.fn() }, actionLog: { create: jest.fn() } } as any,
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

const getFirstCardOfKind = <T extends Card_Unit | Card_Spell>(
  match: LobbyState['match'],
  kind: 'Unit' | 'Spell',
): { id: string; card: T } => {
  const entry = Object.entries(match!.cards).find(([, card]) => card.kind === kind) as
    | [string, T]
    | undefined;
  if (!entry) {
    throw new Error(`No card of kind ${kind}`);
  }
  return { id: entry[0], card: entry[1] };
};

describe('card:playUnit', () => {
  it('rejects placement outside of own side', async () => {
    const lobby = createLobbyState();
    const db = createDbMocks();
    const context = createContext(lobby, lobby.currentPlayerSid!, db);
    const { id: cardId } = getFirstCardOfKind<Card_Unit>(lobby.match, 'Unit');
    lobby.match!.decks[lobby.currentPlayerSid!].hand = [cardId];
    lobby.match!.decks[lobby.currentPlayerSid!].deck = [];
    lobby.match!.mana[lobby.currentPlayerSid!] = MANA_PER_TURN;

    await expect(
      handlePlayUnit(context, { lobbyId: lobby.meta.id, cardId, x: 0, y: SIDE_ROWS.B.min }),
    ).rejects.toMatchObject({ code: 'INVALID_SIDE' } as Partial<ApplicationError>);
  });

  it('rejects placement on occupied cell', async () => {
    const lobby = createLobbyState();
    const db = createDbMocks();
    const context = createContext(lobby, lobby.currentPlayerSid!, db);
    const { id: cardId } = getFirstCardOfKind<Card_Unit>(lobby.match, 'Unit');
    lobby.match!.decks[lobby.currentPlayerSid!].hand = [cardId];
    lobby.match!.mana[lobby.currentPlayerSid!] = MANA_PER_TURN;
    lobby.match!.units.push({
      id: 'existing',
      type: 'Warrior',
      owner: lobby.currentPlayerSid!,
      x: 0,
      y: SIDE_ROWS.A.min,
      canMoveAtTurn: 1,
      hp: 5,
      hpMax: 5,
    });

    await expect(
      handlePlayUnit(context, { lobbyId: lobby.meta.id, cardId, x: 0, y: SIDE_ROWS.A.min }),
    ).rejects.toMatchObject({ code: 'CELL_OCCUPIED' } as Partial<ApplicationError>);
  });

  it('rejects when mana is insufficient', async () => {
    const lobby = createLobbyState();
    const db = createDbMocks();
    const context = createContext(lobby, lobby.currentPlayerSid!, db);
    const { id: cardId } = getFirstCardOfKind<Card_Unit>(lobby.match, 'Unit');
    lobby.match!.decks[lobby.currentPlayerSid!].hand = [cardId];
    lobby.match!.mana[lobby.currentPlayerSid!] = 0;

    await expect(
      handlePlayUnit(context, { lobbyId: lobby.meta.id, cardId, x: 0, y: SIDE_ROWS.A.min }),
    ).rejects.toMatchObject({ code: 'NOT_ENOUGH_MANA' } as Partial<ApplicationError>);
  });

  it('summons a unit and moves card to graveyard', async () => {
    const lobby = createLobbyState();
    const db = createDbMocks();
    const context = createContext(lobby, lobby.currentPlayerSid!, db);
    const { id: cardId, card } = getFirstCardOfKind<Card_Unit>(lobby.match, 'Unit');
    lobby.match!.decks[lobby.currentPlayerSid!].hand = [cardId];
    lobby.match!.decks[lobby.currentPlayerSid!].graveyard = [];
    lobby.match!.mana[lobby.currentPlayerSid!] = MANA_PER_TURN;

    await handlePlayUnit(context, {
      lobbyId: lobby.meta.id,
      cardId,
      x: 0,
      y: SIDE_ROWS.A.min,
    });

    expect(lobby.match!.units).toHaveLength(1);
    expect(lobby.match!.units[0]).toMatchObject({ owner: lobby.currentPlayerSid!, type: card.unitType });
    expect(lobby.match!.mana[lobby.currentPlayerSid!]).toBe(MANA_PER_TURN - card.cost);
    expect(lobby.match!.decks[lobby.currentPlayerSid!].hand).toHaveLength(0);
    expect(lobby.match!.decks[lobby.currentPlayerSid!].graveyard).toContain(cardId);
    expect(db.unit.create).toHaveBeenCalled();
    expect(context.broadcastState).toHaveBeenCalledWith(lobby, {
      type: EVENTS.CARD_PLAY_UNIT,
      payload: { lobbyId: lobby.meta.id, cardId, x: 0, y: SIDE_ROWS.A.min },
    });
  });
});

describe('card:playSpell', () => {
  const setup = () => {
    const lobby = createLobbyState();
    const db = createDbMocks();
    const context = createContext(lobby, lobby.currentPlayerSid!, db);
    lobby.match!.mana[lobby.currentPlayerSid!] = MANA_PER_TURN;
    return { lobby, context, db };
  };

  it('applies damage and removes defeated units', async () => {
    const { lobby, context, db } = setup();
    const { id: cardId, card } = Object.entries(lobby.match!.cards).find(
      ([, value]) => value.kind === 'Spell' && (value as Card_Spell).effects.some((effect) => effect.type === 'damage'),
    ) as [string, Card_Spell];
    lobby.match!.decks[lobby.currentPlayerSid!].hand = [cardId];
    lobby.match!.decks[lobby.currentPlayerSid!].discard = [];
    lobby.match!.units.push({
      id: 'enemy',
      type: 'Warrior',
      owner: 'enemy-player',
      x: 2,
      y: 2,
      canMoveAtTurn: 1,
      hp: 3,
      hpMax: 6,
    });
    lobby.match!.units.push({
      id: 'ally',
      type: 'Mage',
      owner: lobby.currentPlayerSid!,
      x: 3,
      y: 3,
      canMoveAtTurn: 1,
      hp: 4,
      hpMax: 4,
    });

    await handlePlaySpell(context, {
      lobbyId: lobby.meta.id,
      cardId,
      anchorX: 2,
      anchorY: 2,
    });

    expect(lobby.match!.units.find((unit) => unit.id === 'enemy')).toBeUndefined();
    expect(lobby.match!.decks[lobby.currentPlayerSid!].discard).toContain(cardId);
    expect(db.unit.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['enemy'] } } });
    expect(context.broadcastState).toHaveBeenCalledWith(lobby, {
      type: EVENTS.CARD_PLAY_SPELL,
      payload: { lobbyId: lobby.meta.id, cardId, anchorX: 2, anchorY: 2 },
    });
  });

  it('heals allies and respects friendly fire', async () => {
    const { lobby, context } = setup();
    const { id: cardId, card } = Object.entries(lobby.match!.cards).find(
      ([, value]) => value.kind === 'Spell' && (value as Card_Spell).effects.some((effect) => effect.type === 'heal'),
    ) as [string, Card_Spell];
    lobby.match!.decks[lobby.currentPlayerSid!].hand = [cardId];
    lobby.match!.decks[lobby.currentPlayerSid!].discard = [];
    lobby.match!.units.push({
      id: 'ally',
      type: 'Mage',
      owner: lobby.currentPlayerSid!,
      x: 1,
      y: 1,
      canMoveAtTurn: 1,
      hp: 1,
      hpMax: 4,
    });

    await handlePlaySpell(context, {
      lobbyId: lobby.meta.id,
      cardId,
      anchorX: 1,
      anchorY: 1,
    });

    const healed = lobby.match!.units.find((unit) => unit.id === 'ally');
    expect(healed?.hp).toBeGreaterThan(1);
    expect(healed?.hp).toBeLessThanOrEqual(healed?.hpMax ?? 0);
  });

  it('increases max HP when applying fortify', async () => {
    const { lobby, context } = setup();
    const { id: cardId, card } = Object.entries(lobby.match!.cards).find(
      ([, value]) =>
        value.kind === 'Spell' && (value as Card_Spell).effects.some((effect) => effect.type === 'maxHpUp'),
    ) as [string, Card_Spell];
    lobby.match!.decks[lobby.currentPlayerSid!].hand = [cardId];
    lobby.match!.units.push({
      id: 'ally',
      type: 'Warrior',
      owner: lobby.currentPlayerSid!,
      x: 0,
      y: 0,
      canMoveAtTurn: 1,
      hp: 4,
      hpMax: 6,
    });

    await handlePlaySpell(context, {
      lobbyId: lobby.meta.id,
      cardId,
      anchorX: 0,
      anchorY: 0,
    });

    const updated = lobby.match!.units.find((unit) => unit.id === 'ally');
    expect(updated?.hpMax).toBeGreaterThan(6);
    expect(updated?.hp).toBeGreaterThanOrEqual(4);
  });
});

describe('card:playTalent', () => {
  const setup = () => {
    const lobby = createLobbyState();
    const db = createDbMocks();
    const context = createContext(lobby, lobby.currentPlayerSid!, db);
    lobby.match!.mana[lobby.currentPlayerSid!] = MANA_PER_TURN;
    const unit = {
      id: 'talented',
      type: 'Warrior' as const,
      owner: lobby.currentPlayerSid!,
      x: 0,
      y: 0,
      canMoveAtTurn: 1,
      hp: 6,
      hpMax: 6,
    };
    lobby.match!.units.push(unit);
    generateTalentsForPlayer(lobby.match!, lobby.currentPlayerSid!, lobby.match!.turnNumber);
    return { lobby, context, db, unit };
  };

  it('rejects targets out of range', async () => {
    const { lobby, context } = setup();
    const talentId = lobby.match!.talentsInHand[lobby.currentPlayerSid!][0];

    await expect(
      handlePlayTalent(context, {
        lobbyId: lobby.meta.id,
        cardId: talentId,
        targetX: TALENT_RANGE.Warrior + 1,
        targetY: 0,
      }),
    ).rejects.toMatchObject({ code: 'TARGET_OUT_OF_RANGE' } as Partial<ApplicationError>);
  });

  it('rejects if source unit is dead', async () => {
    const { lobby, context, unit } = setup();
    const talentId = lobby.match!.talentsInHand[lobby.currentPlayerSid!][0];
    unit.hp = 0;

    await expect(
      handlePlayTalent(context, {
        lobbyId: lobby.meta.id,
        cardId: talentId,
        targetX: 0,
        targetY: 0,
      }),
    ).rejects.toMatchObject({ code: 'UNIT_NOT_FOUND' } as Partial<ApplicationError>);
  });

  it('applies damage and removes talent from hand', async () => {
    const { lobby, context, db } = setup();
    const talentId = lobby.match!.talentsInHand[lobby.currentPlayerSid!][0];
    lobby.match!.units.push({
      id: 'enemy',
      type: 'Mage',
      owner: 'enemy-player',
      x: 0,
      y: 1,
      canMoveAtTurn: 1,
      hp: 2,
      hpMax: 4,
    });

    await handlePlayTalent(context, {
      lobbyId: lobby.meta.id,
      cardId: talentId,
      targetX: 0,
      targetY: 1,
    });

    expect(lobby.match!.talentsInHand[lobby.currentPlayerSid!]).not.toContain(talentId);
    expect(db.unit.deleteMany).toHaveBeenCalledWith({ where: { id: 'enemy' } });
    expect(context.broadcastState).toHaveBeenCalledWith(lobby, {
      type: EVENTS.CARD_PLAY_TALENT,
      payload: { lobbyId: lobby.meta.id, cardId: talentId, targetX: 0, targetY: 1 },
    });
  });
});

describe('endTurn', () => {
  it('expires talents, resets mana and draws for next player', async () => {
    const lobby = createLobbyState();
    const db = { unit: { create: jest.fn(), deleteMany: jest.fn(), update: jest.fn() } } as DbMocks;
    const context = createContext(lobby, lobby.currentPlayerSid!, db);
    lobby.match!.mana[lobby.currentPlayerSid!] = MANA_PER_TURN;
    lobby.match!.talentsInHand[lobby.currentPlayerSid!] = ['talent-a'];
    lobby.match!.cards['talent-a'] = {
      id: 'talent-a',
      kind: 'Talent',
      sourceUnitId: 'fake',
      unitType: 'Warrior',
      cost: 1,
      range: 1,
      text: 'Damage 2',
      effect: { type: 'damage', amount: 2 },
      expiresAtTurn: lobby.match!.turnNumber,
    } satisfies Card_Talent;
    lobby.match!.decks[lobby.players[1]!.sid].deck.push('extra-card');
    lobby.match!.cards['extra-card'] = {
      id: 'extra-card',
      kind: 'Unit',
      unitType: 'Mage',
      cost: 3,
      hpBase: 4,
    } satisfies Card_Unit;

    await preProcessEndTurn(context, { lobbyId: lobby.meta.id });
    await handleEndTurn(context, { lobbyId: lobby.meta.id });

    const nextPlayer = lobby.players[1]!.sid;
    expect(lobby.match!.mana[lobby.currentPlayerSid!]).toBe(0);
    expect(lobby.match!.mana[nextPlayer]).toBe(MANA_PER_TURN);
    expect(lobby.match!.talentsInHand[lobby.players[0]!.sid]).toHaveLength(0);
    expect(lobby.match!.decks[nextPlayer].hand.length).toBeGreaterThan(0);
    expect(context.broadcastState).toHaveBeenCalledWith(lobby, {
      type: EVENTS.GAME_END_TURN,
      payload: { lobbyId: lobby.meta.id },
    });
  });
});

describe('startTurnForPlayer', () => {
  it('reshuffles discard into deck when drawing', () => {
    const lobby = createLobbyState();
    const player = lobby.currentPlayerSid!;
    lobby.match!.decks[player].hand = [];
    lobby.match!.decks[player].deck = [];
    lobby.match!.decks[player].discard = ['c1', 'c2'];
    lobby.match!.cards['c1'] = {
      id: 'c1',
      kind: 'Unit',
      unitType: 'Mage',
      cost: 3,
      hpBase: 4,
    } satisfies Card_Unit;
    lobby.match!.cards['c2'] = {
      id: 'c2',
      kind: 'Spell',
      name: 'Test Spell',
      cost: 2,
      area: 'cell',
      text: 'Deal 1',
      effects: [{ type: 'damage', amount: 1, friendlyFire: false }],
    } satisfies Card_Spell;

    startTurnForPlayer(lobby.match!, player);

    expect(lobby.match!.decks[player].discard).toHaveLength(0);
    expect(lobby.match!.decks[player].hand).toHaveLength(1);
    expect(lobby.match!.decks[player].deck.length + lobby.match!.decks[player].hand.length).toBeGreaterThan(0);
  });
});
