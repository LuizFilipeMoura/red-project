import { nanoid } from 'nanoid';
import { EVENTS, schemas } from '@repo/shared';
import type { Card_Unit } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../../errors.js';
import type { EventHandler, HandlerContext } from '../../types.js';
import {
  getPlayerSide,
  isCellOccupied,
  isOnBoard,
  isWithinSpawnZone,
} from '../../../game/rules.js';
import {
  findCardInHand,
  moveCardToZone,
  spendMana,
} from '../../../game/cards.js';
import type { LobbyState } from '../../../state.js';

const schema = schemas[EVENTS.CARD_PLAY_UNIT];

type PlayUnitInput = z.infer<typeof schema>;

type ActiveMatch = NonNullable<LobbyState['match']>;

type PlayUnitContextData = {
  lobby: LobbyState;
  match: ActiveMatch;
  card: Card_Unit;
  target: { x: number; y: number };
  release: () => void;
};

type PlayUnitContext = HandlerContext & { [playUnitContextKey]?: PlayUnitContextData };

const playUnitContextKey = Symbol('playUnitContext');

const setPlayUnitContext = (context: HandlerContext, data: PlayUnitContextData) => {
  (context as PlayUnitContext)[playUnitContextKey] = data;
};

const getPlayUnitContext = (context: HandlerContext) => {
  const data = (context as PlayUnitContext)[playUnitContextKey];
  if (!data) {
    throw new ApplicationError('PREPROCESS_REQUIRED', 'Missing play unit pre-processing context');
  }
  return data;
};

const clearPlayUnitContext = (context: HandlerContext) => {
  delete (context as PlayUnitContext)[playUnitContextKey];
};

export const preProcessPlayUnit = async (context: HandlerContext, input: PlayUnitInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  const release = await lobby.mutex.acquire();
  try {
    const match = lobby.match;
    if (!match) {
      throw new ApplicationError('MATCH_NOT_READY', 'Match not initialized');
    }
    if (match.winnerSid) {
      throw new ApplicationError('GAME_OVER', 'Match already finished');
    }
    if (lobby.currentPlayerSid !== context.sid) {
      throw new ApplicationError('NOT_YOUR_TURN', 'It is not your turn');
    }
    if (!isOnBoard(input.x, input.y)) {
      throw new ApplicationError('OUT_OF_BOUNDS', 'Target is outside the board');
    }
    if (isCellOccupied(match, input.x, input.y)) {
      throw new ApplicationError('CELL_OCCUPIED', 'Cell already occupied');
    }

    const deckHasCard = findCardInHand(match, context.sid, input.cardId);
    if (!deckHasCard) {
      throw new ApplicationError('CARD_NOT_IN_HAND', 'Card not in hand');
    }

    const card = match.cards[input.cardId];
    if (!card || card.kind !== 'Unit') {
      throw new ApplicationError('INVALID_CARD_KIND', 'Card must be a Unit');
    }

    const side = getPlayerSide(lobby, context.sid);
    if (!side) {
      throw new ApplicationError('INVALID_SIDE', 'Unable to determine side');
    }
    if (!isWithinSpawnZone(side, input.y)) {
      throw new ApplicationError('INVALID_SIDE', 'Cannot summon outside your side');
    }

    setPlayUnitContext(context, {
      lobby,
      match,
      card,
      target: { x: input.x, y: input.y },
      release,
    });
  } catch (error) {
    release();
    throw error;
  }
};

export const handlePlayUnit: EventHandler<PlayUnitInput> = async (context, input) => {
  const { lobby, match, card, target, release } = getPlayUnitContext(context);
  try {
    try {
      spendMana(match, context.sid, card.cost);
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_ENOUGH_MANA') {
        throw new ApplicationError('NOT_ENOUGH_MANA', 'Not enough mana');
      }
      throw error;
    }

    const unitId = nanoid();
    match.units.push({
      id: unitId,
      type: card.unitType,
      owner: context.sid,
      x: target.x,
      y: target.y,
      canMoveAtTurn: match.turnNumber + 1,
      hp: card.hpBase,
      hpMax: card.hpBase,
    });

    moveCardToZone(match, context.sid, input.cardId, 'graveyard');

    await context.db.unit.create({
      data: {
        id: unitId,
        matchId: lobby.meta.id,
        type: card.unitType,
        ownerSid: context.sid,
        x: target.x,
        y: target.y,
        canMoveAtTurn: match.turnNumber + 1,
        hp: card.hpBase,
        hpMax: card.hpBase,
      },
    });

    await context.broadcastState(lobby, {
      type: EVENTS.CARD_PLAY_UNIT,
      payload: input,
    });
  } finally {
    release();
    clearPlayUnitContext(context);
  }
};

export const playUnitDefinition = {
  event: EVENTS.CARD_PLAY_UNIT,
  schema,
  useRateLimit: true,
  preProcess: preProcessPlayUnit,
  handler: handlePlayUnit,
} as const;
