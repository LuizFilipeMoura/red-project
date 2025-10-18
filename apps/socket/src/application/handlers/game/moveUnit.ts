import { EVENTS, MOVE_RANGE, schemas, FLAG_A, FLAG_B } from '@repo/shared';
import type { z } from 'zod';
import type { EventHandler } from '../../types.js';
import { ApplicationError } from '../../errors.js';
import {
  getPlayerSide,
  isCellOccupied,
  isOnBoard,
  manhattanDistance,
} from '../../../game/rules.js';

const schema = schemas[EVENTS.GAME_MOVE_UNIT];

type MoveUnitInput = z.infer<typeof schema>;

export const handleMoveUnit: EventHandler<MoveUnitInput> = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  await lobby.mutex.runExclusive(async () => {
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

    unit.x = input.toX;
    unit.y = input.toY;

    const side = getPlayerSide(lobby, context.sid);
    const targetFlag = side === 'A' ? FLAG_B : FLAG_A;
    if (unit.x === targetFlag.x && unit.y === targetFlag.y) {
      match.winnerSid = context.sid;
      lobby.meta.status = 'finished';
    }

    await context.broadcastState(lobby, { type: EVENTS.GAME_MOVE_UNIT, payload: input });
  });
};

export const moveUnitDefinition = {
  event: EVENTS.GAME_MOVE_UNIT,
  schema,
  useRateLimit: true,
  handler: handleMoveUnit,
} as const;
