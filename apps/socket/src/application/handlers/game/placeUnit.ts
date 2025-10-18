import { nanoid } from 'nanoid';
import { EVENTS, schemas } from '@repo/shared';
import type { z } from 'zod';
import type { EventHandler, HandlerContext } from '../../types.js';
import { ApplicationError } from '../../errors.js';
import {
  getPlayerSide,
  isCellOccupied,
  isOnBoard,
  isWithinSpawnZone,
  getUnitCost,
} from '../../../game/rules.js';
import type { LobbyState } from '../../../state.js';

const schema = schemas[EVENTS.GAME_PLACE_UNIT];

type PlaceUnitInput = z.infer<typeof schema>;

type PlaceUnitContextData = {
  lobby: LobbyState;
  manaCost: number;
  release: () => void;
};

type PlaceUnitContext = HandlerContext & { [placeUnitContextKey]?: PlaceUnitContextData };

const placeUnitContextKey = Symbol('placeUnitContext');

const setPlaceUnitContext = (context: HandlerContext, data: PlaceUnitContextData) => {
  (context as PlaceUnitContext)[placeUnitContextKey] = data;
};

const getPlaceUnitContext = (context: HandlerContext) => {
  const data = (context as PlaceUnitContext)[placeUnitContextKey];
  if (!data) {
    throw new ApplicationError('PREPROCESS_REQUIRED', 'Missing place unit pre-processing context');
  }
  return data;
};

const clearPlaceUnitContext = (context: HandlerContext) => {
  delete (context as PlaceUnitContext)[placeUnitContextKey];
};

export const preProcessPlaceUnit = async (context: HandlerContext, input: PlaceUnitInput) => {
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

    const side = getPlayerSide(lobby, context.sid);
    if (!side || !isWithinSpawnZone(side, input.y)) {
      throw new ApplicationError('INVALID_SIDE', 'Cannot summon on that row');
    }

    if (isCellOccupied(match, input.x, input.y)) {
      throw new ApplicationError('CELL_OCCUPIED', 'Cell already occupied');
    }

    const cost = getUnitCost(input.type);
    const mana = match.mana[context.sid] ?? 0;
    if (mana < cost) {
      throw new ApplicationError('NOT_ENOUGH_MANA', 'Not enough mana');
    }

    setPlaceUnitContext(context, { lobby, manaCost: cost, release });
  } catch (error) {
    release();
    throw error;
  }
};

export const handlePlaceUnit: EventHandler<PlaceUnitInput> = async (context, input) => {
  const { lobby, manaCost, release } = getPlaceUnitContext(context);
  const match = lobby.match!;
  try {
    match.mana[context.sid] = (match.mana[context.sid] ?? 0) - manaCost;
    match.units.push({
      id: nanoid(),
      type: input.type,
      owner: context.sid,
      x: input.x,
      y: input.y,
      canMoveAtTurn: match.turnNumber + 1,
    });

    await context.broadcastState(lobby, { type: EVENTS.GAME_PLACE_UNIT, payload: input });
  } finally {
    release();
    clearPlaceUnitContext(context);
  }
};

export const placeUnitDefinition = {
  event: EVENTS.GAME_PLACE_UNIT,
  schema,
  useRateLimit: true,
  preProcess: preProcessPlaceUnit,
  handler: handlePlaceUnit,
} as const;
