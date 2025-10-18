import { EVENTS, schemas } from '@repo/shared';
import type { Card_Spell } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../../errors.js';
import type { EventHandler, HandlerContext } from '../../types.js';
import { isOnBoard } from '../../../game/rules.js';
import {
  applySpellCard,
  findCardInHand,
  moveCardToZone,
  spendMana,
} from '../../../game/cards.js';
import type { LobbyState } from '../../../state.js';

const schema = schemas[EVENTS.CARD_PLAY_SPELL];

type PlaySpellInput = z.infer<typeof schema>;

type ActiveMatch = NonNullable<LobbyState['match']>;

type PlaySpellContextData = {
  lobby: LobbyState;
  match: ActiveMatch;
  card: Card_Spell;
  anchor: { x: number; y: number };
  release: () => void;
};

type PlaySpellContext = HandlerContext & { [playSpellContextKey]?: PlaySpellContextData };

const playSpellContextKey = Symbol('playSpellContext');

const setPlaySpellContext = (context: HandlerContext, data: PlaySpellContextData) => {
  (context as PlaySpellContext)[playSpellContextKey] = data;
};

const getPlaySpellContext = (context: HandlerContext) => {
  const data = (context as PlaySpellContext)[playSpellContextKey];
  if (!data) {
    throw new ApplicationError('PREPROCESS_REQUIRED', 'Missing play spell pre-processing context');
  }
  return data;
};

const clearPlaySpellContext = (context: HandlerContext) => {
  delete (context as PlaySpellContext)[playSpellContextKey];
};

export const preProcessPlaySpell = async (context: HandlerContext, input: PlaySpellInput) => {
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
    if (!isOnBoard(input.anchorX, input.anchorY)) {
      throw new ApplicationError('OUT_OF_BOUNDS', 'Anchor outside of board');
    }

    const deckHasCard = findCardInHand(match, context.sid, input.cardId);
    if (!deckHasCard) {
      throw new ApplicationError('CARD_NOT_IN_HAND', 'Card not in hand');
    }

    const card = match.cards[input.cardId];
    if (!card || card.kind !== 'Spell') {
      throw new ApplicationError('INVALID_CARD_KIND', 'Card must be a Spell');
    }

    setPlaySpellContext(context, {
      lobby,
      match,
      card,
      anchor: { x: input.anchorX, y: input.anchorY },
      release,
    });
  } catch (error) {
    release();
    throw error;
  }
};

export const handlePlaySpell: EventHandler<PlaySpellInput> = async (context, input) => {
  const { lobby, match, card, anchor, release } = getPlaySpellContext(context);
  try {
    try {
      spendMana(match, context.sid, card.cost);
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_ENOUGH_MANA') {
        throw new ApplicationError('NOT_ENOUGH_MANA', 'Not enough mana');
      }
      throw error;
    }

    const result = applySpellCard(match, context.sid, card, anchor);

    moveCardToZone(match, context.sid, input.cardId, 'discard');

    if (result.removedUnits.length > 0) {
      await context.db.unit.deleteMany({
        where: { id: { in: result.removedUnits } },
      });
    }

    await context.broadcastState(lobby, {
      type: EVENTS.CARD_PLAY_SPELL,
      payload: input,
    });
  } finally {
    release();
    clearPlaySpellContext(context);
  }
};

export const playSpellDefinition = {
  event: EVENTS.CARD_PLAY_SPELL,
  schema,
  useRateLimit: true,
  preProcess: preProcessPlaySpell,
  handler: handlePlaySpell,
} as const;
