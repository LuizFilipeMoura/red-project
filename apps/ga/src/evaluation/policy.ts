import seedrandom from 'seedrandom';
import type { StateSync, MatchState, Card_Unit, Card_Spell, Card_Talent } from '@repo/shared';
import { SIDE_ROWS } from '@repo/shared';
import type { PolicyGenome } from '../types.js';
import type { GameAction } from './gameClient.js';
import { logger } from '../logger.js';

export class AIPolicy {
  private rng: () => number;
  private actionCount: number = 0;

  constructor(
    private genome: PolicyGenome,
    seed: string,
  ) {
    this.rng = seedrandom(seed);
  }

  /**
   * Decide the next action based on the current game state and genome parameters
   */
  decideAction(state: StateSync): GameAction {
    if (!state.match || !state.yourSid) {
      // Don't count this as an action since it's an error state
      return { type: 'endTurn' };
    }

    const match = state.match;
    const mySid = state.yourSid;

    // Not my turn
    if (match.currentPlayerSid !== mySid) {
      // Don't count this as an action since it's not our turn
      return { type: 'endTurn' };
    }

    const isFirstAction = this.actionCount === 0;

    const myMana = match.mana[mySid] ?? 0;
    const myDeck = match.decks[mySid];
    const myUnits = match.units.filter((u) => u.owner === mySid);
    const enemyUnits = match.units.filter((u) => u.owner !== mySid);

    // Determine my side
    const playerOrder = Object.keys(match.mana);
    const mySide = playerOrder[0] === mySid ? 'A' : 'B';
    const enemySide = mySide === 'A' ? 'B' : 'A';

    // Aggression: probability to play units/spells vs just moving/ending
    // Caution: affects defensive vs offensive positioning
    // Tempo: affects whether to play cards quickly or wait
    // Noise: randomness in decisions

    const actionProbs = this.calculateActionProbabilities();

    // Add noise to action selection
    const noiseModifier = (this.rng() - 0.5) * this.genome.noise;

    // Decide action type
    const roll = this.rng();

    // High aggression = more likely to play cards
    if (roll < actionProbs.playCard && myMana > 0 && myDeck) {
      // Try to play a unit card
      const unitCards = myDeck.hand
        .map((cardId) => ({ id: cardId, card: match.cards[cardId] }))
        .filter((c) => c.card?.kind === 'Unit') as Array<{ id: string; card: Card_Unit }>;

      if (unitCards.length > 0) {
        const affordableUnits = unitCards.filter((c) => c.card.cost <= myMana);
        if (affordableUnits.length > 0) {
          const selectedCard = affordableUnits[Math.floor(this.rng() * affordableUnits.length)]!;
          const spawnPos = this.selectSpawnPosition(match, mySid, mySide);
          if (spawnPos) {
            this.actionCount++;
            logger.debug(
              {
                genome: this.genome,
                action: 'playUnit',
                unitType: selectedCard.card.unitType,
                cost: selectedCard.card.cost,
                position: spawnPos,
                occupiedPositions: match.units.map(u => `(${u.x},${u.y})`).join(', ')
              },
              `AI playing ${selectedCard.card.unitType} at (${spawnPos.x},${spawnPos.y})`
            );
            return { type: 'playUnit', cardId: selectedCard.id, x: spawnPos.x, y: spawnPos.y };
          } else {
            logger.warn(
              {
                genome: this.genome,
                unitType: selectedCard.card.unitType,
                side: mySide,
                totalUnits: match.units.length,
                myUnits: myUnits.length
              },
              'No valid spawn position available for unit'
            );
          }
        }
      }

      // Try to play spell
      const spellCards = myDeck.hand
        .map((cardId) => ({ id: cardId, card: match.cards[cardId] }))
        .filter((c) => c.card?.kind === 'Spell') as Array<{ id: string; card: Card_Spell }>;

      if (spellCards.length > 0) {
        const affordableSpells = spellCards.filter((c) => c.card.cost <= myMana);
        if (affordableSpells.length > 0) {
          const selectedCard = affordableSpells[Math.floor(this.rng() * affordableSpells.length)]!;
          const target = this.selectSpellTarget(match, mySid, enemyUnits);
          if (target) {
            this.actionCount++;
            logger.debug(
              {
                genome: this.genome,
                action: 'playSpell',
                spellName: selectedCard.card.name,
                cost: selectedCard.card.cost,
                target
              },
              `AI casting ${selectedCard.card.name} at (${target.x},${target.y})`
            );
            return {
              type: 'playSpell',
              cardId: selectedCard.id,
              anchorX: target.x,
              anchorY: target.y,
            };
          }
        }
      }
    }

    // Try to move units
    if (roll < actionProbs.moveUnit && myUnits.length > 0) {
      const movableUnits = myUnits.filter((u) => u.canMoveAtTurn <= match.turnNumber);
      if (movableUnits.length > 0) {
        const unitToMove = movableUnits[Math.floor(this.rng() * movableUnits.length)]!;
        const destination = this.selectMoveDestination(match, unitToMove, mySide, enemySide);
        if (destination) {
          this.actionCount++;
          logger.debug(
            {
              genome: this.genome,
              action: 'moveUnit',
              unitType: unitToMove.type,
              from: { x: unitToMove.x, y: unitToMove.y },
              to: destination
            },
            `AI moving ${unitToMove.type} from (${unitToMove.x},${unitToMove.y}) to (${destination.x},${destination.y})`
          );
          return {
            type: 'moveUnit',
            unitId: unitToMove.id,
            toX: destination.x,
            toY: destination.y,
          };
        }
      }
    }

    // If this is the first action, we MUST do something other than end turn
    if (isFirstAction) {
      // Force play a card or move a unit
      logger.info(
        {
          genome: this.genome,
          mana: myMana,
          handSize: myDeck?.hand.length ?? 0,
          unitCount: myUnits.length
        },
        'First action of the game - forcing non-endTurn action'
      );

      // Try to play any affordable card
      if (myMana > 0 && myDeck) {
        const allCards = myDeck.hand.map((cardId) => ({ id: cardId, card: match.cards[cardId] }));
        const affordableCards = allCards.filter(
          (c) => c.card && 'cost' in c.card && c.card.cost <= myMana
        );

        if (affordableCards.length > 0) {
          const selectedCard = affordableCards[0]!;

          if (selectedCard.card.kind === 'Unit') {
            const spawnPos = this.selectSpawnPosition(match, mySid, mySide);
            if (spawnPos) {
              this.actionCount++;
              return { type: 'playUnit', cardId: selectedCard.id, x: spawnPos.x, y: spawnPos.y };
            }
          } else if (selectedCard.card.kind === 'Spell') {
            const target = this.selectSpellTarget(match, mySid, enemyUnits);
            if (target) {
              this.actionCount++;
              return {
                type: 'playSpell',
                cardId: selectedCard.id,
                anchorX: target.x,
                anchorY: target.y,
              };
            }
          }
        }
      }

      // If we can't play a card, try to move a unit (if any exist)
      if (myUnits.length > 0) {
        const movableUnits = myUnits.filter((u) => u.canMoveAtTurn <= match.turnNumber);
        if (movableUnits.length > 0) {
          const unitToMove = movableUnits[0]!;
          const destination = this.selectMoveDestination(match, unitToMove, mySide, enemySide);
          if (destination) {
            this.actionCount++;
            return {
              type: 'moveUnit',
              unitId: unitToMove.id,
              toX: destination.x,
              toY: destination.y,
            };
          }
        }
      }

      // If we absolutely can't do anything else, fall through to end turn
      // (this should be rare - only if we have no mana, no cards, and no units)
      logger.warn({ genome: this.genome }, 'First action but no valid actions available');
    }

    // Default: end turn
    logger.debug(
      {
        genome: this.genome,
        action: 'endTurn',
        actionCount: this.actionCount,
        turnNumber: match.turnNumber
      },
      `AI ending turn (action #${this.actionCount + 1}, turn ${match.turnNumber})`
    );
    return { type: 'endTurn' };
  }

  private calculateActionProbabilities() {
    // High aggression = more card plays
    // High tempo = faster plays
    // High caution = less aggressive moves
    return {
      playCard: this.genome.aggression * (1 - this.genome.caution * 0.5) * 0.7,
      moveUnit: 0.3 + this.genome.tempo * 0.4,
      endTurn: this.genome.caution * 0.3,
    };
  }

  private selectSpawnPosition(
    match: MatchState,
    mySid: string,
    mySide: 'A' | 'B',
  ): { x: number; y: number } | null {
    const spawnZone = SIDE_ROWS[mySide];
    const candidates: Array<{ x: number; y: number }> = [];

    for (let y = spawnZone.min; y <= spawnZone.max; y++) {
      for (let x = 0; x < match.board.width; x++) {
        const occupied = match.units.some((u) => u.x === x && u.y === y);
        if (!occupied) {
          candidates.push({ x, y });
        }
      }
    }

    if (candidates.length === 0) return null;

    // Caution affects whether we spawn defensively (back) or aggressively (front)
    if (this.genome.caution > 0.5) {
      // Defensive: prefer spawn positions farther from enemy
      candidates.sort((a, b) => {
        const distA = mySide === 'A' ? a.y : match.board.height - a.y;
        const distB = mySide === 'A' ? b.y : match.board.height - b.y;
        return distA - distB;
      });
    } else {
      // Aggressive: prefer spawn positions closer to enemy
      candidates.sort((a, b) => {
        const distA = mySide === 'A' ? a.y : match.board.height - a.y;
        const distB = mySide === 'A' ? b.y : match.board.height - b.y;
        return distB - distA;
      });
    }

    // Pick from top candidates with some randomness
    const topCount = Math.min(3, candidates.length);
    return candidates[Math.floor(this.rng() * topCount)]!;
  }

  private selectSpellTarget(
    match: MatchState,
    mySid: string,
    enemyUnits: Array<{ x: number; y: number }>,
  ): { x: number; y: number } | null {
    if (enemyUnits.length === 0) return null;

    // High aggression = target enemies, low aggression = might target randomly
    if (this.genome.aggression > 0.5) {
      return enemyUnits[Math.floor(this.rng() * enemyUnits.length)]!;
    }

    // Random target on board
    return {
      x: Math.floor(this.rng() * match.board.width),
      y: Math.floor(this.rng() * match.board.height),
    };
  }

  private selectMoveDestination(
    match: MatchState,
    unit: { x: number; y: number; id: string; type: string },
    mySide: 'A' | 'B',
    enemySide: 'A' | 'B',
  ): { x: number; y: number } | null {
    const enemyFlag = enemySide === 'A' ? match.board.flagA : match.board.flagB;

    // High aggression = move towards enemy flag
    // High caution = stay defensive
    // High tempo = prefer movement

    const candidates: Array<{ x: number; y: number; score: number }> = [];

    // Simple movement: consider adjacent cells
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const nx = unit.x + dx;
      const ny = unit.y + dy;

      if (nx < 0 || nx >= match.board.width || ny < 0 || ny >= match.board.height) continue;

      const occupied = match.units.some((u) => u.x === nx && u.y === ny);
      if (occupied) continue;

      // Score based on distance to enemy flag
      const distToFlag = Math.abs(nx - enemyFlag.x) + Math.abs(ny - enemyFlag.y);
      const score = this.genome.aggression * (10 - distToFlag) + this.rng() * this.genome.noise * 5;

      candidates.push({ x: nx, y: ny, score });
    }

    if (candidates.length === 0) return null;

    // Sort by score and pick best
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]!;
  }
}
