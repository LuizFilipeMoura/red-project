import geneticJs from 'genetic-js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { ensureStorage, persistEpisodes, persistGeneration, saveWeights } from '../persistence/storage.js';
import { telemetryClient } from '../telemetry.js';
import type { PolicyGenome } from '../types.js';
import { Evaluator, type IndividualEvaluation } from '../evaluation/evaluator.js';

const Genetic: any = geneticJs as any;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const selectBestEpisode = (evaluation: IndividualEvaluation) => {
  const sorted = [...evaluation.episodes].sort((a, b) => {
    const fitnessA = a.win ? 1000 - a.turns : a.score - 100;
    const fitnessB = b.win ? 1000 - b.turns : b.score - 100;
    return fitnessB - fitnessA;
  });
  return sorted[0] ?? evaluation.episodes[0];
};

export class GARunner {
  private evaluator = new Evaluator();

  private seedGenome(): PolicyGenome {
    return {
      aggression: Math.random(),
      caution: Math.random(),
      tempo: Math.random(),
      noise: Math.random(),
    };
  }

  private mutateGenome(genome: PolicyGenome): PolicyGenome {
    const delta = () => (Math.random() - 0.5) * 0.2;
    return {
      aggression: clamp01(genome.aggression + delta()),
      caution: clamp01(genome.caution + delta()),
      tempo: clamp01(genome.tempo + delta()),
      noise: clamp01(genome.noise + delta()),
    };
  }

  private crossoverGenome(mother: PolicyGenome, father: PolicyGenome): [PolicyGenome, PolicyGenome] {
    const child1: PolicyGenome = {
      aggression: clamp01((mother.aggression + father.aggression) / 2),
      caution: clamp01((mother.caution + father.caution) / 2),
      tempo: clamp01(mother.tempo),
      noise: clamp01(father.noise),
    };
    const child2: PolicyGenome = {
      aggression: clamp01(mother.aggression * 0.6 + father.aggression * 0.4),
      caution: clamp01(father.caution * 0.6 + mother.caution * 0.4),
      tempo: clamp01((mother.tempo + father.tempo) / 2),
      noise: clamp01((mother.noise + father.noise) / 2),
    };
    return [child1, child2];
  }

  async run() {
    await ensureStorage();
    const genetic = Genetic.create();
    const evaluationsByGeneration = new Map<number, IndividualEvaluation[]>();
    let evaluatingGeneration = 0;

    genetic.optimize = Genetic.Optimize.Maximize;
    genetic.select1 = Genetic.Select1.Tournament2;
    genetic.select2 = Genetic.Select2.Tournament3;
    genetic.seed = () => this.seedGenome();
    genetic.mutate = (entity: PolicyGenome) => this.mutateGenome(entity);
    genetic.crossover = (mother: PolicyGenome, father: PolicyGenome) =>
      this.crossoverGenome(mother, father);

    genetic.fitness = async (entity: PolicyGenome) => {
      const generation = evaluatingGeneration;
      const evaluation = await this.evaluator.evaluate(entity, generation);
      const list = evaluationsByGeneration.get(generation) ?? [];
      list.push(evaluation);
      evaluationsByGeneration.set(generation, list);
      return evaluation.stats.fitness;
    };

    let finishResolver: (() => void) | undefined;

    genetic.notification = async (
      population: Array<{ entity: PolicyGenome; score: number }>,
      generation: number,
      _stats: unknown,
      isFinished: boolean,
    ) => {
      const evaluations = evaluationsByGeneration.get(generation) ?? [];
      if (evaluations.length === 0) {
        logger.warn({ generation }, 'No evaluations recorded for generation');
        if (isFinished && finishResolver) finishResolver();
        return;
      }

      const sorted = [...evaluations].sort((a, b) => b.stats.fitness - a.stats.fitness);
      const best = sorted[0]!;
      const fitnessValues = evaluations.map((item) => item.stats.fitness);
      const mean = fitnessValues.reduce((total, value) => total + value, 0) / fitnessValues.length;
      const variance =
        fitnessValues.reduce((total, value) => total + (value - mean) ** 2, 0) /
        fitnessValues.length;
      const orderedFitness = [...fitnessValues].sort((a, b) => a - b);
      const p90 = orderedFitness[Math.min(orderedFitness.length - 1, Math.floor(orderedFitness.length * 0.9))];

      const sampleSummaries = sorted.slice(0, Math.min(5, sorted.length)).map((item) => ({
        weightsHash: item.weightsHash,
        fitness: item.stats.fitness,
        mean: item.stats.mean,
        p90: item.stats.p90,
        variance: item.stats.variance,
        sampleSize: item.stats.sampleSize,
      }));

      const bestEpisode = selectBestEpisode(best);

      const snapshot = {
        gen: generation,
        population: population.length,
        best: {
          fitness: best.stats.fitness,
          weightsHash: best.weightsHash,
          entropy: best.stats.entropy,
          winRate: best.stats.winRate,
          turns: bestEpisode?.turns,
          score: bestEpisode?.score,
        },
        mean,
        p90,
        variance,
        bestEpisode,
        episodes: best.episodes,
        samples: sampleSummaries,
        timestamp: Date.now(),
      };

      await persistGeneration(snapshot);
      await persistEpisodes(best.episodes);
      await saveWeights(best.genome, best.weightsHash);

      evaluationsByGeneration.delete(generation);

      telemetryClient
        .sendSnapshot(snapshot)
        .catch((error) => logger.error({ err: error }, 'Failed to send telemetry snapshot'));

      logger.info(
        {
          generation,
          bestFitness: best.stats.fitness,
          meanFitness: mean,
        },
        'Completed GA generation',
      );

      if (isFinished && finishResolver) {
        finishResolver();
      }

      evaluatingGeneration = generation + 1;
    };

    await new Promise<void>((resolve) => {
      finishResolver = resolve;
      genetic.evolve(
        {
          iterations: env.GA_GENERATIONS,
          size: env.GA_POPULATION_SIZE,
          crossover: env.GA_CROSSOVER_PROB,
          mutation: env.GA_MUTATION_PROB,
          skip: 0,
          elitism: env.GA_ELITISM,
        },
        {},
      );
    });
  }
}
