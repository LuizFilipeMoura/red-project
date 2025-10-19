import seedrandom from 'seedrandom';
import { EVENTS } from '@repo/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { persistTrace, hashWeights } from '../persistence/storage.js';
import type { EpisodeResult, IndividualStats, PolicyGenome } from '../types.js';

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

    for (let index = 0; index < env.GA_SEED_COUNT; index += 1) {
      const seed = `${generationSeed}-${index}-${Math.floor(generationRng() * 1e9)}`;
      const rng = seedrandom(seed);
      const win = rng() < normalized.aggression * (1 - normalized.caution * 0.5);
      const baseTurns = Math.max(6, Math.round(rng() * env.GA_EPISODE_MAX_TURNS));
      const tempoBonus = normalized.tempo * 10 - normalized.caution * 5;
      const turns = Math.max(6, Math.round(baseTurns - tempoBonus));
      const scoreNoise = (rng() - 0.5) * 50 * (1 + normalized.noise);
      const score = win
        ? 200 - turns * 1.5 + scoreNoise
        : -80 + tempoBonus + scoreNoise;
      const frameCount = Math.max(5, Math.min(40, Math.round(turns / 2)));
      const frames = buildTraceFrames(seed, turns, frameCount);
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

    const stats = aggregateStats(episodes, entropy);
    logger.debug({ generation, weightsHash, fitness: stats.fitness }, 'Evaluated genome');

    return {
      genome: normalized,
      weightsHash,
      stats,
      episodes,
    };
  }
}
