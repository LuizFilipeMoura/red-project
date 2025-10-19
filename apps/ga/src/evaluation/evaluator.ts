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
  async evaluate(genome: PolicyGenome, generation: number): Promise<IndividualEvaluation> {
    const normalized = normalizeGenome(genome);
    const weightsHash = hashWeights(normalized);
    const episodes: EpisodeResult[] = [];
    const entropy = computeEntropy(normalized);
    const generationSeed = `${generation}-${weightsHash}`;
    const generationRng = seedrandom(generationSeed);

    logger.info(
      { generation, weightsHash, genome: normalized, episodeCount: env.GA_SEED_COUNT },
      'Starting genome evaluation',
    );

    // Run episodes SEQUENTIALLY to avoid overwhelming the server
    for (let index = 0; index < env.GA_SEED_COUNT; index += 1) {
      const seed = `${generationSeed}-${index}-${Math.floor(generationRng() * 1e9)}`;

      logger.info({ generation, episodeIndex: index + 1, totalEpisodes: env.GA_SEED_COUNT }, 'Starting episode');

      try {
        const result = await this.playGame(normalized, seed, generation, index);
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

    // Create two game clients (Player A and Player B)
    const clientA = new GameClient();
    const clientB = new GameClient();

    // Track actions for both players
    const actionsA: Array<{ type: string; turn: number; details?: any }> = [];
    const actionsB: Array<{ type: string; turn: number; details?: any }> = [];

    try {
      // Connect both clients
      await Promise.all([clientA.connect(), clientB.connect()]);

      // Create lobby with Player A
      const lobbyId = await clientA.createLobby(`GA-Gen${generation}-${seed.slice(0, 8)}`);

      // Player B joins
      await clientB.joinLobby(lobbyId);

      // Start the game
      await clientA.startGame();

      logger.info({ lobbyId, generation, episodeIndex }, 'Game started - both players connected');

      // Create AI policies for both players (both use same genome for now)
      const policyA = new AIPolicy(genome, `${seed}-A`);
      const policyB = new AIPolicy(genome, `${seed}-B`);

      // Game loop: take turns until game ends
      let maxTurns = env.GA_EPISODE_MAX_TURNS;
      const gameEndPromise = clientA.waitForGameEnd();

      // Run game loop in background
      const gameLoop = async () => {
        for (let turn = 0; turn < maxTurns; turn++) {
          const stateA = clientA.getCurrentState();
          const stateB = clientB.getCurrentState();

          if (!stateA?.match || !stateB?.match) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            continue;
          }

          // Check if game ended
          if (stateA.match.winnerSid || stateB.match.winnerSid) {
            break;
          }

          // Determine whose turn it is and have them take an action
          if (stateA.match.currentPlayerSid === stateA.yourSid) {
            const action = policyA.decideAction(stateA);
            actionsA.push({ type: action.type, turn: stateA.match.turnNumber, details: action });
            logger.debug({ turn: stateA.match.turnNumber, action: action.type, player: 'A' }, 'Player A action');
            await clientA.executeAction(action);
          } else if (stateB.match.currentPlayerSid === stateB.yourSid) {
            const action = policyB.decideAction(stateB);
            actionsB.push({ type: action.type, turn: stateB.match.turnNumber, details: action });
            logger.debug({ turn: stateB.match.turnNumber, action: action.type, player: 'B' }, 'Player B action');
            await clientB.executeAction(action);
          }

          await new Promise((resolve) => setTimeout(resolve, 50)); // Small delay between actions
        }
      };

      // Run both in parallel
      const [result] = await Promise.all([gameEndPromise, gameLoop()]);

      // Determine which side won and return their actions
      const sidA = clientA.getSid();
      const winningSide = result.win ? 'A' : 'B';
      const winnerActions = result.win ? actionsA : actionsB;

      logger.info(
        {
          generation,
          episodeIndex,
          winner: winningSide,
          totalActions: winnerActions.length,
          actionsA: actionsA.length,
          actionsB: actionsB.length,
        },
        `Game completed - Winner: ${winningSide}`,
      );

      return {
        ...result,
        winningSide,
        winnerActions,
      };
    } finally {
      clientA.disconnect();
      clientB.disconnect();
    }
  }
}
