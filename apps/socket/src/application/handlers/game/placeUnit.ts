import { nanoid } from 'nanoid';
import { EVENTS, schemas } from '@repo/shared';
import type { z } from 'zod';
import type { EventHandler } from '../../types.js';
import { ApplicationError } from '../../errors.js';
import { getPlayerSide, isCellOccupied, isOnBoard, isWithinSpawnZone, getUnitCost } from '../../../game/rules.js';

const schema = schemas[EVENTS.GAME_PLACE_UNIT];

type PlaceUnitInput = z.infer<typeof schema>;

export const handlePlaceUnit: EventHandler<PlaceUnitInput> = async (context, input) => {
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

    match.mana[context.sid] = mana - cost;
    match.units.push({
      id: nanoid(),
      type: input.type,
      owner: context.sid,
      x: input.x,
      y: input.y,
      canMoveAtTurn: match.turnNumber + 1,
    });

    await context.broadcastState(lobby, { type: EVENTS.GAME_PLACE_UNIT, payload: input });
  });
};

export const placeUnitDefinition = {
  event: EVENTS.GAME_PLACE_UNIT,
  schema,
  useRateLimit: true,
  handler: handlePlaceUnit,
} as const;
