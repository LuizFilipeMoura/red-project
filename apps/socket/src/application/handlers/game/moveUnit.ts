import { EVENTS, MOVE_RANGE, schemas } from '@repo/shared';
import type { z } from 'zod';
import type { EventHandler, HandlerContext } from '../../types.js';
import { ApplicationError } from '../../errors.js';
import {
  getPlayerSide,
  isCellOccupied,
  isOnBoard,
  manhattanDistance,
  getFlagCaptureWinner,
} from '../../../game/rules.js';
import type { LobbyState } from '../../../state.js';

const schema = schemas[EVENTS.GAME_MOVE_UNIT];

type MoveUnitInput = z.infer<typeof schema>;

type ActiveMatch = NonNullable<LobbyState['match']>;

type MoveUnitContextData = {
  lobby: LobbyState;
  unit: ActiveMatch['units'][number];
  target: { x: number; y: number };
  release: () => void;
};

type MoveUnitContext = HandlerContext & { [moveUnitContextKey]?: MoveUnitContextData };

const moveUnitContextKey = Symbol('moveUnitContext');

const setMoveUnitContext = (context: HandlerContext, data: MoveUnitContextData) => {
  (context as MoveUnitContext)[moveUnitContextKey] = data;
};

const getMoveUnitContext = (context: HandlerContext) => {
  const data = (context as MoveUnitContext)[moveUnitContextKey];
  if (!data) {
    throw new ApplicationError('PREPROCESS_REQUIRED', 'Missing move unit pre-processing context');
  }
  return data;
};

const clearMoveUnitContext = (context: HandlerContext) => {
  delete (context as MoveUnitContext)[moveUnitContextKey];
};

export const preProcessMoveUnit = async (context: HandlerContext, input: MoveUnitInput) => {
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

    const unit = match.units.find((u) => u.id === input.unitId);
    if (!unit) {
      throw new ApplicationError('NOT_FOUND', 'Unit not found');
    }
    if (unit.owner !== context.sid) {
      throw new ApplicationError('NOT_OWNER', 'You do not control this unit');
    }
    if (match.turnNumber < unit.canMoveAtTurn) {
      throw new ApplicationError('UNIT_NOT_READY', 'Unit cannot move yet');
    }

    if (!isOnBoard(input.toX, input.toY)) {
      throw new ApplicationError('OUT_OF_BOUNDS', 'Target is outside the board');
    }
    if (unit.x === input.toX && unit.y === input.toY) {
      throw new ApplicationError('INVALID_MOVE', 'Unit must move to a different cell');
    }
    if (isCellOccupied(match, input.toX, input.toY)) {
      throw new ApplicationError('CELL_OCCUPIED', 'Destination is occupied');
    }

    const range = MOVE_RANGE[unit.type];
    const distance = manhattanDistance(unit.x, unit.y, input.toX, input.toY);
    if (distance > range) {
      throw new ApplicationError('MOVE_TOO_FAR', 'Destination is out of range');
    }

    if (!getPlayerSide(lobby, context.sid)) {
      throw new ApplicationError('INVALID_STATE', 'Unable to determine player side');
    }
    setMoveUnitContext(context, {
      lobby,
      unit,
      target: { x: input.toX, y: input.toY },
      release,
    });
  } catch (error) {
    release();
    throw error;
  }
};

export const handleMoveUnit: EventHandler<MoveUnitInput> = async (context, input) => {
  const { lobby, unit, target, release } = getMoveUnitContext(context);
  const match = lobby.match!;
  try {
    unit.x = target.x;
    unit.y = target.y;
    unit.canMoveAtTurn = match.turnNumber + 1;

    const winnerSid = getFlagCaptureWinner(lobby, match);
    if (winnerSid) {
      match.winnerSid = winnerSid;
      lobby.meta.status = 'finished';
    }

    await context.broadcastState(lobby, { type: EVENTS.GAME_MOVE_UNIT, payload: input });
  } finally {
    release();
    clearMoveUnitContext(context);
  }
};

export const moveUnitDefinition = {
  event: EVENTS.GAME_MOVE_UNIT,
  schema,
  useRateLimit: true,
  preProcess: preProcessMoveUnit,
  handler: handleMoveUnit,
} as const;
