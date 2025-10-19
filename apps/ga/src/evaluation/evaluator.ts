import seedrandom from 'seedrandom';
import { EVENTS } from '@repo/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { persistTrace, hashWeights } from '../persistence/storage.js';
import type { EpisodeResult, IndividualStats, PolicyGenome } from '../types.js';
import { GameClient } from './gameClient.js';
import { AIPolicy } from './policy.js';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const normalizeGenome = (genome: PolicyGenome): PolicyGenome => ({
  aggression: clamp01(genome.aggression),
  caution: clamp01(genome.caution),
  tempo: clamp01(genome.tempo),
  noise: clamp01(genome.noise),
});

const computeEntropy = (genome: PolicyGenome) => {
  const values = Object.values(genome);
  const sum = values.reduce((total, value) => total + value, 0) || 1;
  return values.reduce((total, value) => {
    const p = value / sum;
    if (p <= 0) return total;
    return total - p * Math.log2(p);
  }, 0);
};

const fitnessPerEpisode = (episode: EpisodeResult) =>
  episode.win ? 1000 - episode.turns : episode.score - 100;

const aggregateStats = (episodes: EpisodeResult[], entropy: number): IndividualStats => {
  const perEpisode = episodes.map(fitnessPerEpisode);
  const mean = perEpisode.reduce((total, value) => total + value, 0) / perEpisode.length;
  const variance =
    perEpisode.reduce((total, value) => total + (value - mean) ** 2, 0) / perEpisode.length;
  const sorted = [...perEpisode].sort((a, b) => a - b);
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  const winRate =
    episodes.filter((episode) => episode.win).length / Math.max(1, episodes.length);
  const fitness = mean - env.GA_BETA * variance + env.GA_ALPHA * entropy;
  return {
    weightsHash: episodes[0]?.weightsHash ?? '',
    fitness,
    mean,
    p90,
    variance,
    sampleSize: episodes.length,
    winRate,
    entropy,
  } satisfies IndividualStats;
};

const buildTraceFrames = (seed: string, turns: number, count: number) => {
  const frames = [] as { frame: number; timestamp: number; match: unknown; action?: { type: string; payload: unknown } }[];
  const now = Date.now();
  for (let index = 0; index < count; index += 1) {
    frames.push({
      frame: index,
      timestamp: now + index * 150,
      match: null,
      action: {
        type: EVENTS.GAME_END_TURN,
        payload: { seed, turn: index },
      },
    });
  }
  return frames;
};

export type IndividualEvaluation = {
  genome: PolicyGenome;
  weightsHash: string;
  stats: IndividualStats;
  episodes: EpisodeResult[];
};

export class Evaluator {
  async evaluate(
    genome: PolicyGenome,
    generation: number,
    opponentGenome?: PolicyGenome
  ): Promise<IndividualEvaluation> {
    const normalized = normalizeGenome(genome);
    const weightsHash = hashWeights(normalized);
    const episodes: EpisodeResult[] = [];
    const entropy = computeEntropy(normalized);
    const generationSeed = `${generation}-${weightsHash}`;
    const generationRng = seedrandom(generationSeed);

    // Use opponent genome or self-play if no opponent provided
    const opponent = opponentGenome ? normalizeGenome(opponentGenome) : normalized;
    const opponentHash = hashWeights(opponent);
    const isSelfPlay = !opponentGenome;

    logger.info(
      {
        generation,
        weightsHash,
        opponentHash,
        isSelfPlay,
        genome: normalized,
        opponent,
        episodeCount: env.GA_SEED_COUNT
      },
      isSelfPlay
        ? 'Starting genome evaluation (self-play)'
        : 'Starting genome evaluation (vs previous champion)',
    );

    // Run episodes SEQUENTIALLY to avoid overwhelming the server
    for (let index = 0; index < env.GA_SEED_COUNT; index += 1) {
      const seed = `${generationSeed}-${index}-${Math.floor(generationRng() * 1e9)}`;

      logger.info({ generation, episodeIndex: index + 1, totalEpisodes: env.GA_SEED_COUNT }, 'Starting episode');

      try {
        const result = await this.playGame(normalized, opponent, seed, generation, index);
        const traceRef = await persistTrace(generation, seed, result.trace);

        episodes.push({
          gen: generation,
          seed,
          win: result.win,
          turns: result.turns,
          score: result.score,
          weightsHash,
          engineVersion: env.GA_ENGINE_VERSION,
          policyVersion: env.GA_POLICY_VERSION,
          traceRef,
        });

        logger.info(
          {
            generation,
            episodeIndex: index + 1,
            seed,
            win: result.win,
            turns: result.turns,
            score: result.score,
            winningSide: result.winningSide,
          },
          `Episode ${index + 1}/${env.GA_SEED_COUNT} completed - ${result.win ? 'VICTORY' : 'DEFEAT'}`,
        );

        // Log winner's actions
        if (result.winnerActions && result.winnerActions.length > 0) {
          logger.info(
            { actions: result.winnerActions },
            `Winner (${result.winningSide}) action sequence:`,
          );
        }
      } catch (error) {
        logger.error({ err: error, generation, seed, episodeIndex: index + 1 }, 'Failed to play game episode');
        // Fall back to mock result on error
        const rng = seedrandom(seed);
        const win = rng() < 0.5;
        const turns = Math.max(6, Math.round(rng() * env.GA_EPISODE_MAX_TURNS));
        const score = win ? 200 - turns * 1.5 : -80;
        const frames = buildTraceFrames(seed, turns, 10);
        const traceRef = await persistTrace(generation, seed, frames);

        episodes.push({
          gen: generation,
          seed,
          win,
          turns,
          score,
          weightsHash,
          engineVersion: env.GA_ENGINE_VERSION,
          policyVersion: env.GA_POLICY_VERSION,
          traceRef,
        });
      }
    }

    const stats = aggregateStats(episodes, entropy);
    const winCount = episodes.filter((e) => e.win).length;
    logger.info(
      {
        generation,
        weightsHash,
        fitness: stats.fitness,
        wins: winCount,
        losses: episodes.length - winCount,
        winRate: `${((winCount / episodes.length) * 100).toFixed(1)}%`,
      },
      'Genome evaluation completed',
    );

    return {
      genome: normalized,
      weightsHash,
      stats,
      episodes,
    };
  }

  private async playGame(
    genome: PolicyGenome,
    opponentGenome: PolicyGenome,
    seed: string,
    generation: number,
    episodeIndex: number,
  ): Promise<{
    win: boolean;
    turns: number;
    score: number;
    trace: any[];
    winningSide?: string;
    winnerActions?: Array<{ type: string; turn: number; details?: any }>;
  }> {
    logger.info({ seed, generation, episodeIndex }, 'Starting real game episode');

    // Track actions for both players
    const actionsA: Array<{ type: string; turn: number; details?: any }> = [];
    const actionsB: Array<{ type: string; turn: number; details?: any }> = [];

    // Create Client A first
    const clientA = new GameClient();
    let clientB: GameClient | undefined;

    try {
      // Connect Client A
      logger.info({ seed, generation }, 'Connecting Client A');
      await clientA.connect();
      logger.info({ clientA_socketId: clientA.getSocketId() }, 'Client A connected');

      // Create lobby with Player A and wait for confirmation
      logger.info({ generation, seed }, 'Client A creating lobby');
      const lobbyId = await clientA.createLobby(`GA-Gen${generation}-${seed.slice(0, 8)}`);
      logger.info({ lobbyId, clientA_socketId: clientA.getSocketId() }, 'Lobby created, confirmed by Client A');

      // NOW create and connect Client B
      logger.info({ lobbyId }, 'Creating Client B');
      clientB = new GameClient();

      logger.info({ lobbyId }, 'Connecting Client B');
      await clientB.connect();
      logger.info({ clientB_socketId: clientB.getSocketId() }, 'Client B connected');

      // Player B joins the existing lobby
      logger.info({ lobbyId, generation, seed }, 'Client B joining lobby');
      await clientB.joinLobby(lobbyId);
      logger.info({ lobbyId }, 'Client B joined successfully');

      // Start the game
      logger.info({ lobbyId }, 'Calling startGame on Client A');
      await clientA.startGame();

      logger.info(
        {
          lobbyId,
          generation,
          episodeIndex,
          playerA: 'candidate genome',
          playerB: opponentGenome === genome ? 'self (clone)' : 'opponent genome'
        },
        'Game started - both players connected'
      );

      // Create AI policies: Player A = candidate genome, Player B = opponent genome
      const policyA = new AIPolicy(genome, `${seed}-A`);
      const policyB = new AIPolicy(opponentGenome, `${seed}-B`);

      // Game loop: take turns until game ends (max 62 turns)
      const MAX_TURNS = 62;
      const gameEndPromise = clientA.waitForGameEnd(MAX_TURNS);

      // Run game loop in background
      const gameLoop = async () => {
        if (!clientB) throw new Error('ClientB not initialized');

        let lastActionTime = Date.now();
        const INACTIVITY_TIMEOUT = 5000; // 5 seconds
        console.log("urn < MAX_TURNS", MAX_TURNS)

        for (let turn = 0; turn < MAX_TURNS; turn++) {
          // Small delay to let state updates propagate
          await new Promise((resolve) => setTimeout(resolve, env.GA_ACTION_DELAY_MS));

          const stateA = clientA.getCurrentState();
          const stateB = clientB.getCurrentState();

          if (!stateA?.match || !stateB?.match) {
            await new Promise((resolve) => setTimeout(resolve, env.GA_ACTION_DELAY_MS));
            continue;
          }

          // Check if game ended
          if (stateA.match.winnerSid || stateB.match.winnerSid) {
            break;
          }

          // Check if we've reached turn 62 - both players lose
          if (stateA.match.turnNumber >= MAX_TURNS) {
            logger.info({ turn: stateA.match.turnNumber }, 'Game reached turn 62 - both players lose');
            break;
          }

          // Check for inactivity timeout
          const timeSinceLastAction = Date.now() - lastActionTime;
          if (timeSinceLastAction > INACTIVITY_TIMEOUT) {
            logger.warn(
              {
                timeSinceLastAction,
                turn: stateA.match.turnNumber,
                lastActionsA: actionsA.slice(-3),
                lastActionsB: actionsB.slice(-3)
              },
              `Game stuck - no actions for ${(timeSinceLastAction / 1000).toFixed(1)}s, ending game`
            );
            break;
          }

          // Determine whose turn it is and have them take an action
          if (stateA.match.currentPlayerSid === stateA.yourSid) {
            const action = policyA.decideAction(stateA);
            actionsA.push({ type: action.type, turn: stateA.match.turnNumber, details: action });
            logger.info(
              {
                turn: stateA.match.turnNumber,
                player: 'A',
                action: action.type,
                details: action,
                sid: stateA.yourSid
              },
              `Player A (${stateA.yourSid?.slice(0, 8)}) - Turn ${stateA.match.turnNumber}: ${action.type}`
            );
            await clientA.executeAction(action);
            lastActionTime = Date.now(); // Reset timeout
          } else if (stateB.match.currentPlayerSid === stateB.yourSid) {
            const action = policyB.decideAction(stateB);
            actionsB.push({ type: action.type, turn: stateB.match.turnNumber, details: action });
            logger.info(
              {
                turn: stateB.match.turnNumber,
                player: 'B',
                action: action.type,
                details: action,
                sid: stateB.yourSid
              },
              `Player B (${stateB.yourSid?.slice(0, 8)}) - Turn ${stateB.match.turnNumber}: ${action.type}`
            );
            await clientB.executeAction(action);
            lastActionTime = Date.now(); // Reset timeout
          }
        }
      };

      // Run both in parallel
      const [resultA] = await Promise.all([gameEndPromise, gameLoop()]);

      // Get final state from both clients to calculate scores
      const finalStateA = clientA.getCurrentState();
      const finalStateB = clientB.getCurrentState();

      if (!finalStateA?.match || !finalStateB?.match) {
        throw new Error('No final match state available');
      }

      const finalMatch = finalStateA.match;
      const turns = finalMatch.turnNumber;

      // Calculate proximity scores for both players
      const scoreA = this.calculatePlayerFlagProximityScore(
        finalMatch,
        clientA.getSid()!,
        turns
      );
      const scoreB = this.calculatePlayerFlagProximityScore(
        finalMatch,
        clientB.getSid()!,
        turns
      );

      // Determine winner by score (higher is better)
      // If there's a server-declared winner, use that; otherwise compare scores
      let winningSide: string;
      let winnerActions: Array<{ type: string; turn: number; details?: any }>;
      let win: boolean;
      let score: number;

      if (finalMatch.winnerSid) {
        // Server declared a winner (e.g., one player destroyed the other)
        win = finalMatch.winnerSid === clientA.getSid();
        winningSide = win ? 'A' : 'B';
        winnerActions = win ? actionsA : actionsB;
        score = win ? scoreA : scoreB;
      } else {
        // No server winner - compare proximity scores
        win = scoreA > scoreB; // From perspective of player A
        winningSide = win ? 'A' : 'B';
        winnerActions = win ? actionsA : actionsB;
        score = win ? scoreA : scoreB;
      }

      logger.info(
        {
          generation,
          episodeIndex,
          winner: winningSide,
          scoreA,
          scoreB,
          scoreDiff: Math.abs(scoreA - scoreB),
          totalActions: winnerActions.length,
          actionsA: actionsA.length,
          actionsB: actionsB.length,
          turns,
          serverWinner: finalMatch.winnerSid ? 'yes' : 'no'
        },
        `Game completed - Winner: ${winningSide} (scoreA: ${scoreA.toFixed(1)}, scoreB: ${scoreB.toFixed(1)})`
      );

      return {
        win,
        turns,
        score,
        trace: resultA.trace,
        winningSide,
        winnerActions,
      };
    } finally {
      clientA.disconnect();
      if (clientB) {
        clientB.disconnect();
      }
    }
  }

  private calculatePlayerFlagProximityScore(match: any, playerSid: string, turns: number): number {
    // Get player's units
    const myUnits = match.units.filter((unit: any) => unit.owner === playerSid);

    if (myUnits.length === 0) {
      return -200; // No units left, worst score
    }

    // Determine which flag is the enemy's
    // Side A starts at rows 0-3 with flag at (0,0), enemy flag is B at (7,7)
    // Side B starts at rows 4-7 with flag at (7,7), enemy flag is A at (0,0)
    const isPlayerA = myUnits.some((unit: any) => unit.y <= 3);
    const enemyFlag = isPlayerA ? { x: 7, y: 7 } : { x: 0, y: 0 };

    // Find minimum distance from any unit to enemy flag (Manhattan distance)
    const minDistance = Math.min(
      ...myUnits.map((unit: any) =>
        Math.abs(unit.x - enemyFlag.x) + Math.abs(unit.y - enemyFlag.y)
      )
    );

    // Score: closer to flag = higher score, fewer turns = higher score
    // Max distance on 8x8 board is 14 (from corner to corner)
    // Base score: (14 - distance) * 10 = 0 to 140
    // Turn penalty: -turns (to reward getting there faster)
    const distanceScore = (14 - minDistance) * 10;
    const turnPenalty = turns * 0.5;

    return distanceScore - turnPenalty;
  }
}
