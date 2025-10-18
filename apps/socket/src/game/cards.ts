import { nanoid } from 'nanoid';
import {
  BOARD_H,
  BOARD_W,
  MANA_PER_TURN,
  MOVE_RANGE,
  TALENT_RANGE,
  UNIT_COST,
  UNIT_HP,
  type AreaShape,
  type Card_Spell,
  type Card_Talent,
  type Card_Unit,
  type DeckState,
  type MatchState,
  type SpellEffect,
  type Unit,
  type UnitType,
} from '@repo/shared';

const shuffle = <T>(items: T[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const UNIT_BLUEPRINT: Array<{ unitType: UnitType; copies: number }> = [
  { unitType: 'Mage', copies: 3 },
  { unitType: 'Warrior', copies: 4 },
  { unitType: 'Archer', copies: 3 },
];

const SPELL_BLUEPRINT: Array<
  Omit<Card_Spell, 'id'> & { id?: string; copies: number }
> = [
  {
    copies: 1,
    kind: 'Spell',
    name: 'Arcane Insight',
    cost: 1,
    area: 'cell',
    text: 'Draw two cards from your deck.',
    effects: [{ type: 'draw', amount: 2, friendlyFire: false }],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Firebolt Precision',
    cost: 2,
    area: 'cell',
    text: 'Deal 3 damage to a single target.',
    effects: [{ type: 'damage', amount: 3, friendlyFire: false }],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Healing Wave',
    cost: 2,
    area: 'cell',
    text: 'Heal an allied unit by 3 HP.',
    effects: [{ type: 'heal', amount: 3, friendlyFire: false }],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Fortify Armor',
    cost: 3,
    area: 'cell',
    text: 'Grant +2 max HP and heal 2 to an allied unit.',
    effects: [
      { type: 'maxHpUp', amount: 2, friendlyFire: false },
      { type: 'heal', amount: 2, friendlyFire: false },
    ],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Flame Sweep',
    cost: 3,
    area: 'row',
    text: 'Deal 2 damage to every unit in a row. Hits allies.',
    effects: [{ type: 'damage', amount: 2, friendlyFire: true }],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Piercing Column',
    cost: 4,
    area: 'col',
    text: 'Deal 2 damage to every unit in a column.',
    effects: [{ type: 'damage', amount: 2, friendlyFire: false }],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Meteor Shower',
    cost: 5,
    area: { shape: 'square2x2' },
    text: 'Deal 4 damage to a 2x2 area. Hits allies.',
    effects: [{ type: 'damage', amount: 4, friendlyFire: true }],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Verdant Growth',
    cost: 4,
    area: { shape: 'diag', length: 2 },
    text: 'Heal units along a diagonal by 2 HP.',
    effects: [{ type: 'heal', amount: 2, friendlyFire: false }],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Static Field',
    cost: 1,
    area: 'cell',
    text: 'Deal 1 damage to a target and draw a card.',
    effects: [
      { type: 'damage', amount: 1, friendlyFire: false },
      { type: 'draw', amount: 1, friendlyFire: false },
    ],
  },
  {
    copies: 1,
    kind: 'Spell',
    name: 'Sanctuary Beacon',
    cost: 3,
    area: 'col',
    text: 'Heal 2 HP to units in a column.',
    effects: [{ type: 'heal', amount: 2, friendlyFire: false }],
  },
];

const ensureDeckState = (match: MatchState, sid: string) => {
  if (!match.decks[sid]) {
    match.decks[sid] = { deck: [], hand: [], discard: [], graveyard: [] };
  }
  if (!match.mana[sid]) {
    match.mana[sid] = 0;
  }
  if (!match.talentsInHand[sid]) {
    match.talentsInHand[sid] = [];
  }
};

export const createInitialDecks = (playerSids: string[]): Pick<MatchState, 'cards' | 'decks'> => {
  const cards: MatchState['cards'] = {};
  const decks: MatchState['decks'] = {};

  for (const sid of playerSids) {
    const cardIds: string[] = [];

    for (const blueprint of UNIT_BLUEPRINT) {
      for (let i = 0; i < blueprint.copies; i += 1) {
        const id = `unit-${blueprint.unitType}-${nanoid(10)}`;
        const card: Card_Unit = {
          id,
          kind: 'Unit',
          unitType: blueprint.unitType,
          cost: UNIT_COST[blueprint.unitType],
          hpBase: UNIT_HP[blueprint.unitType],
        };
        cards[id] = card;
        cardIds.push(id);
      }
    }

    for (const spell of SPELL_BLUEPRINT) {
      for (let i = 0; i < spell.copies; i += 1) {
        const id = `spell-${spell.name.replace(/\s+/g, '-').toLowerCase()}-${nanoid(10)}`;
        const card: Card_Spell = { ...spell, id };
        cards[id] = card;
        cardIds.push(id);
      }
    }

    decks[sid] = {
      deck: shuffle(cardIds),
      hand: [],
      discard: [],
      graveyard: [],
    };
  }

  return { cards, decks };
};

const recycleDeck = (deck: DeckState) => {
  if (deck.deck.length === 0 && deck.discard.length > 0) {
    deck.deck = shuffle(deck.discard);
    deck.discard = [];
  }
};

export const drawCard = (match: MatchState, sid: string): string | null => {
  ensureDeckState(match, sid);
  const deck = match.decks[sid]!;
  recycleDeck(deck);
  const cardId = deck.deck.shift();
  if (!cardId) return null;
  deck.hand.push(cardId);
  return cardId;
};

export const moveCardToZone = (
  match: MatchState,
  sid: string,
  cardId: string,
  zone: keyof DeckState,
) => {
  ensureDeckState(match, sid);
  const deck = match.decks[sid]!;
  deck.hand = deck.hand.filter((id) => id !== cardId);
  deck.discard = deck.discard.filter((id) => id !== cardId);
  deck.graveyard = deck.graveyard.filter((id) => id !== cardId);
  deck.deck = deck.deck.filter((id) => id !== cardId);
  deck[zone].push(cardId);
};

const TALENT_EFFECTS: Record<UnitType, { text: string; effect: Card_Talent['effect'] }> = {
  Mage: {
    text: 'Mage talent: deal 3 damage within range 2.',
    effect: { type: 'damage', amount: 3 },
  },
  Warrior: {
    text: 'Warrior talent: heal 2 HP on an adjacent ally.',
    effect: { type: 'heal', amount: 2 },
  },
  Archer: {
    text: 'Archer talent: deal 2 damage within range 3.',
    effect: { type: 'damage', amount: 2 },
  },
};

export const clearTalentsForPlayer = (match: MatchState, sid: string) => {
  const talentIds = match.talentsInHand[sid] ?? [];
  for (const talentId of talentIds) {
    delete match.cards[talentId];
  }
  match.talentsInHand[sid] = [];
};

export const removeTalentCard = (match: MatchState, sid: string, cardId: string) => {
  const talents = match.talentsInHand[sid] ?? [];
  match.talentsInHand[sid] = talents.filter((id) => id !== cardId);
  delete match.cards[cardId];
};

export const removeTalentsForUnit = (match: MatchState, unitId: string) => {
  for (const sid of Object.keys(match.talentsInHand)) {
    const talents = match.talentsInHand[sid] ?? [];
    const keep: string[] = [];
    for (const cardId of talents) {
      const card = match.cards[cardId];
      if (!card || card.kind !== 'Talent' || card.sourceUnitId !== unitId) {
        keep.push(cardId);
      } else {
        delete match.cards[cardId];
      }
    }
    match.talentsInHand[sid] = keep;
  }
};

export const generateTalentsForPlayer = (match: MatchState, sid: string, turnNumber: number) => {
  ensureDeckState(match, sid);
  const newTalentIds: string[] = [];
  const existing = match.talentsInHand[sid] ?? [];
  const toRemove = new Set<string>();

  for (const talentId of existing) {
    const card = match.cards[talentId];
    if (!card || card.kind !== 'Talent') continue;
    toRemove.add(card.sourceUnitId);
  }

  match.talentsInHand[sid] = [];

  for (const unit of match.units.filter((u) => u.owner === sid && u.hp > 0)) {
    if (toRemove.has(unit.id)) {
      removeTalentsForUnit(match, unit.id);
    }
    const talentId = `talent-${unit.id}-${turnNumber}-${nanoid(6)}`;
    const template = TALENT_EFFECTS[unit.type];
    const card: Card_Talent = {
      id: talentId,
      kind: 'Talent',
      sourceUnitId: unit.id,
      unitType: unit.type,
      cost: 1,
      range: TALENT_RANGE[unit.type],
      text: template.text,
      effect: { ...template.effect },
      expiresAtTurn: turnNumber,
    };
    match.cards[talentId] = card;
    newTalentIds.push(talentId);
  }

  match.talentsInHand[sid] = newTalentIds;
  return newTalentIds;
};

export const startTurnForPlayer = (match: MatchState, sid: string) => {
  ensureDeckState(match, sid);
  drawCard(match, sid);
  generateTalentsForPlayer(match, sid, match.turnNumber);
  match.mana[sid] = MANA_PER_TURN;
};

const cellsInSquare = (anchor: { x: number; y: number }) => {
  const cells: Array<{ x: number; y: number }> = [];
  for (let dx = 0; dx < 2; dx += 1) {
    for (let dy = 0; dy < 2; dy += 1) {
      cells.push({ x: anchor.x + dx, y: anchor.y + dy });
    }
  }
  return cells;
};

const cellsInDiag = (anchor: { x: number; y: number }, length: number) => {
  const cells: Array<{ x: number; y: number }> = [{ x: anchor.x, y: anchor.y }];
  for (let step = 1; step <= length; step += 1) {
    cells.push({ x: anchor.x + step, y: anchor.y + step });
    cells.push({ x: anchor.x - step, y: anchor.y + step });
    cells.push({ x: anchor.x + step, y: anchor.y - step });
    cells.push({ x: anchor.x - step, y: anchor.y - step });
  }
  return cells;
};

export const resolveAreaCells = (area: AreaShape, anchor: { x: number; y: number }) => {
  const cells: Array<{ x: number; y: number }> = [];
  const pushIfValid = (cell: { x: number; y: number }) => {
    if (cell.x >= 0 && cell.x < BOARD_W && cell.y >= 0 && cell.y < BOARD_H) {
      cells.push(cell);
    }
  };

  if (area === 'cell') {
    pushIfValid(anchor);
  } else if (area === 'row') {
    for (let x = 0; x < BOARD_W; x += 1) {
      pushIfValid({ x, y: anchor.y });
    }
  } else if (area === 'col') {
    for (let y = 0; y < BOARD_H; y += 1) {
      pushIfValid({ x: anchor.x, y });
    }
  } else if (typeof area === 'object' && area.shape === 'square2x2') {
    for (const cell of cellsInSquare(anchor)) {
      pushIfValid(cell);
    }
  } else if (typeof area === 'object' && area.shape === 'diag') {
    for (const cell of cellsInDiag(anchor, area.length)) {
      pushIfValid(cell);
    }
  }

  return cells;
};

const applyEffectToUnit = (
  effect: SpellEffect,
  casterSid: string,
  unit: Unit,
) => {
  switch (effect.type) {
    case 'damage': {
      if (!effect.friendlyFire && unit.owner === casterSid) return;
      unit.hp = Math.max(0, unit.hp - effect.amount);
      break;
    }
    case 'heal': {
      if (!effect.friendlyFire && unit.owner !== casterSid) return;
      unit.hp = Math.min(unit.hpMax, unit.hp + effect.amount);
      break;
    }
    case 'maxHpUp': {
      if (!effect.friendlyFire && unit.owner !== casterSid) return;
      unit.hpMax += effect.amount;
      break;
    }
    default:
      break;
  }
};

export const applySpellCard = (
  match: MatchState,
  casterSid: string,
  card: Card_Spell,
  anchor: { x: number; y: number },
) => {
  const removedUnits: string[] = [];

  for (const effect of card.effects) {
    if (effect.type !== 'draw') continue;
    for (let i = 0; i < effect.amount; i += 1) {
      drawCard(match, casterSid);
    }
  }

  const areaEffects = card.effects.filter((effect) => effect.type !== 'draw');
  if (areaEffects.length === 0) {
    return { removedUnits };
  }

  const areaCells = resolveAreaCells(card.area, anchor);

  for (const unit of match.units) {
    const inArea = areaCells.some((cell) => cell.x === unit.x && cell.y === unit.y);
    if (!inArea) continue;
    for (const effect of areaEffects) {
      applyEffectToUnit(effect, casterSid, unit);
    }
    if (unit.hp <= 0) {
      removedUnits.push(unit.id);
    }
  }

  if (removedUnits.length > 0) {
    match.units = match.units.filter((unit) => !removedUnits.includes(unit.id));
    for (const unitId of removedUnits) {
      removeTalentsForUnit(match, unitId);
    }
  }

  return { removedUnits };
};

export const canUnitMoveTo = (unit: Unit, toX: number, toY: number) => {
  const range = MOVE_RANGE[unit.type];
  const distance = Math.abs(unit.x - toX) + Math.abs(unit.y - toY);
  return distance <= range;
};

export const findCardInHand = (match: MatchState, sid: string, cardId: string) => {
  ensureDeckState(match, sid);
  return match.decks[sid]?.hand.includes(cardId) ?? false;
};

export const spendMana = (match: MatchState, sid: string, amount: number) => {
  ensureDeckState(match, sid);
  const current = match.mana[sid] ?? 0;
  if (current < amount) {
    throw new Error('NOT_ENOUGH_MANA');
  }
  match.mana[sid] = current - amount;
};

export const refundMana = (match: MatchState, sid: string, amount: number) => {
  ensureDeckState(match, sid);
  match.mana[sid] = (match.mana[sid] ?? 0) + amount;
};

export const expireTalents = (match: MatchState, sid: string) => {
  clearTalentsForPlayer(match, sid);
};
