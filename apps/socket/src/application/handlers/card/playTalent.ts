import { EVENTS, manhattan, schemas } from '@repo/shared';
import type { Card_Talent } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../../errors.js';
import type { EventHandler, HandlerContext } from '../../types.js';
import { isOnBoard } from '../../../game/rules.js';
import { removeTalentsForUnit, removeTalentCard, spendMana } from '../../../game/cards.js';
import type { LobbyState } from '../../../state.js';

const schema = schemas[EVENTS.CARD_PLAY_TALENT];

type PlayTalentInput = z.infer<typeof schema>;

type ActiveMatch = NonNullable<LobbyState['match']>;

type PlayTalentContextData = {
  lobby: LobbyState;
  match: ActiveMatch;
  card: Card_Talent;
  targetUnit: ActiveMatch['units'][number];
  release: () => void;
};

type PlayTalentContext = HandlerContext & { [playTalentContextKey]?: PlayTalentContextData };

const playTalentContextKey = Symbol('playTalentContext');

const setPlayTalentContext = (context: HandlerContext, data: PlayTalentContextData) => {
  (context as PlayTalentContext)[playTalentContextKey] = data;
};

const getPlayTalentContext = (context: HandlerContext) => {
  const data = (context as PlayTalentContext)[playTalentContextKey];
  if (!data) {
    throw new ApplicationError('PREPROCESS_REQUIRED', 'Missing play talent pre-processing context');
  }
  return data;
};

const clearPlayTalentContext = (context: HandlerContext) => {
  delete (context as PlayTalentContext)[playTalentContextKey];
};

export const preProcessPlayTalent = async (context: HandlerContext, input: PlayTalentInput) => {
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
    if (!isOnBoard(input.targetX, input.targetY)) {
      throw new ApplicationError('OUT_OF_BOUNDS', 'Target outside board');
    }

    const talents = match.talentsInHand[context.sid] ?? [];
    if (!talents.includes(input.cardId)) {
      throw new ApplicationError('CARD_NOT_IN_HAND', 'Talent not available');
    }

    const card = match.cards[input.cardId];
    if (!card || card.kind !== 'Talent') {
      throw new ApplicationError('INVALID_CARD_KIND', 'Card must be a Talent');
    }

    const sourceUnit = match.units.find((unit) => unit.id === card.sourceUnitId);
    if (!sourceUnit) {
      removeTalentCard(match, context.sid, card.id);
      throw new ApplicationError('UNIT_NOT_FOUND', 'Source unit not found');
    }
    if (sourceUnit.owner !== context.sid) {
      throw new ApplicationError('UNIT_NOT_OWNED', 'Source unit not controlled by you');
    }
    if (sourceUnit.hp <= 0) {
      removeTalentCard(match, context.sid, card.id);
      throw new ApplicationError('UNIT_NOT_FOUND', 'Source unit is not alive');
    }

    const distance = manhattan(
      { x: sourceUnit.x, y: sourceUnit.y },
      { x: input.targetX, y: input.targetY },
    );
    if (distance > card.range) {
      throw new ApplicationError('TARGET_OUT_OF_RANGE', 'Target out of talent range');
    }

    const targetUnit = match.units.find(
      (unit) => unit.x === input.targetX && unit.y === input.targetY,
    );
    if (!targetUnit) {
      throw new ApplicationError('UNIT_NOT_FOUND', 'No unit at target');
    }

    if (card.effect.type === 'heal' && targetUnit.owner !== context.sid) {
      throw new ApplicationError('UNIT_NOT_OWNED', 'Cannot heal enemy units');
    }

    setPlayTalentContext(context, {
      lobby,
      match,
      card,
      targetUnit,
      release,
    });
  } catch (error) {
    release();
    throw error;
  }
};

export const handlePlayTalent: EventHandler<PlayTalentInput> = async (context, input) => {
  const { lobby, match, card, targetUnit, release } = getPlayTalentContext(context);
  try {
    try {
      spendMana(match, context.sid, card.cost);
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_ENOUGH_MANA') {
        throw new ApplicationError('NOT_ENOUGH_MANA', 'Not enough mana');
      }
      throw error;
    }

    if (card.effect.type === 'damage') {
      targetUnit.hp = Math.max(0, targetUnit.hp - card.effect.amount);
    } else if (card.effect.type === 'heal') {
      targetUnit.hp = Math.min(targetUnit.hpMax, targetUnit.hp + card.effect.amount);
    }

    if (targetUnit.hp <= 0) {
      match.units = match.units.filter((unit) => unit.id !== targetUnit.id);
      removeTalentsForUnit(match, targetUnit.id);
      await context.db.unit.deleteMany({ where: { id: targetUnit.id } });
    }

    removeTalentCard(match, context.sid, card.id);

    await context.broadcastState(lobby, {
      type: EVENTS.CARD_PLAY_TALENT,
      payload: input,
    });
  } finally {
    release();
    clearPlayTalentContext(context);
  }
};

export const playTalentDefinition = {
  event: EVENTS.CARD_PLAY_TALENT,
  schema,
  useRateLimit: true,
  preProcess: preProcessPlayTalent,
  handler: handlePlayTalent,
} as const;
