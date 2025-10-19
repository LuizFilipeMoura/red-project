import { env } from '../env.js';
import { logger } from '../logger.js';
import { ensureStorage, persistEpisodes, persistGeneration, saveWeights } from '../persistence/storage.js';
import { telemetryClient } from '../telemetry.js';
import type { PolicyGenome } from '../types.js';
import { Evaluator, type IndividualEvaluation } from '../evaluation/evaluator.js';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const selectBestEpisode = (evaluation: IndividualEvaluation) => {
  const sorted = [...evaluation.episodes].sort((a, b) => {
    const fitnessA = a.win ? 1000 - a.turns : a.score - 100;
    const fitnessB = b.win ? 1000 - b.turns : b.score - 100;
    return fitnessB - fitnessA;
  });
  return sorted[0] ?? evaluation.episodes[0];
};

const cloneGenome = (genome: PolicyGenome): PolicyGenome => ({ ...genome });

const tournamentSelect = (evaluations: IndividualEvaluation[], tournamentSize: number) => {
  if (evaluations.length === 0) throw new Error('Cannot select from empty population');

  let best: IndividualEvaluation | undefined;
  for (let index = 0; index < tournamentSize; index += 1) {
    const candidate = evaluations[Math.floor(Math.random() * evaluations.length)];
    if (!best || candidate.stats.fitness > best.stats.fitness) {
      best = candidate;
    }
  }

  return best!;
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
    logger.info(
      {
        populationSize: env.GA_POPULATION_SIZE,
        generations: env.GA_GENERATIONS,
        dataDir: env.GA_DATA_DIR,
        generationsPath: env.GA_GENERATIONS_PATH,
        episodesPath: env.GA_EPISODES_PATH,
        weightsDir: env.GA_WEIGHTS_DIR,
      },
      'Starting GA run',
    );
    let population: PolicyGenome[] = Array.from({ length: env.GA_POPULATION_SIZE }, () => this.seedGenome());
    let previousChampion: PolicyGenome | undefined = undefined;

    for (let generation = 0; generation < env.GA_GENERATIONS; generation += 1) {
      logger.info(
        {
          generation,
          totalGenerations: env.GA_GENERATIONS,
          populationSize: population.length,
        },
        '='.repeat(80),
      );
      logger.info(
        {
          generation,
          totalGenerations: env.GA_GENERATIONS,
          populationSize: population.length,
        },
        `🧬 GENERATION ${generation + 1}/${env.GA_GENERATIONS} - Population: ${population.length} individuals`,
      );

      // Evaluate population sequentially to avoid overwhelming the server
      const evaluations: IndividualEvaluation[] = [];
      for (let i = 0; i < population.length; i += 1) {
        logger.info(
          {
            generation,
            individualIndex: i + 1,
            totalIndividuals: population.length,
            hasPreviousChampion: !!previousChampion
          },
          '-'.repeat(80),
        );
        logger.info(
          {
            generation,
            individualIndex: i + 1,
            totalIndividuals: population.length,
            hasPreviousChampion: !!previousChampion,
            genome: population[i]
          },
          previousChampion
            ? `🎮 Testing Individual ${i + 1}/${population.length} (Gen ${generation + 1}) vs Previous Champion`
            : `🎮 Testing Individual ${i + 1}/${population.length} (Gen ${generation + 1}) - Self-Play`,
        );
        const evaluation = await this.evaluator.evaluate(population[i]!, generation, previousChampion);
        evaluations.push(evaluation);

        logger.info(
          {
            generation,
            individualIndex: i + 1,
            fitness: evaluation.stats.fitness,
            winRate: evaluation.stats.winRate,
            meanScore: evaluation.stats.mean
          },
          `✅ Individual ${i + 1}/${population.length} Complete - Fitness: ${evaluation.stats.fitness.toFixed(2)}, Win Rate: ${(evaluation.stats.winRate * 100).toFixed(1)}%`,
        );
      }

      if (evaluations.length === 0) {
        logger.warn({ generation }, 'No evaluations recorded for generation');
        continue;
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
        population: evaluations.length,
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

      // Log generation summary
      logger.info(
        {
          generation,
          bestFitness: best.stats.fitness,
          meanFitness: mean,
          bestWinRate: best.stats.winRate,
          bestGenome: best.genome,
          bestHash: best.weightsHash
        },
        '='.repeat(80),
      );
      logger.info(
        {
          generation,
          bestFitness: best.stats.fitness,
          meanFitness: mean,
          bestWinRate: best.stats.winRate,
        },
        `🏆 GENERATION ${generation + 1} COMPLETE - Best Fitness: ${best.stats.fitness.toFixed(2)}, Mean: ${mean.toFixed(2)}, Win Rate: ${(best.stats.winRate * 100).toFixed(1)}%`,
      );

      // Update champion for next generation
      previousChampion = best.genome;
      logger.info(
        {
          generation,
          championFitness: best.stats.fitness,
          championGenome: best.genome,
          championHash: best.weightsHash
        },
        `👑 New Champion Set for Generation ${generation + 2} - Fitness: ${best.stats.fitness.toFixed(2)}`,
      );
      await saveWeights(best.genome, best.weightsHash);
      logger.debug(
        {
          generation,
          generationsPath: env.GA_GENERATIONS_PATH,
          episodesPath: env.GA_EPISODES_PATH,
          weightsHash: best.weightsHash,
        },
        'Persisted GA artifacts',
      );

      telemetryClient
        .sendSnapshot(snapshot)
        .catch((error) => logger.error({ err: error, generation }, 'Failed to send telemetry snapshot'));

      logger.info(
        {
          generation,
          bestFitness: best.stats.fitness,
          meanFitness: mean,
        },
        'Completed GA generation',
      );

      if (generation === env.GA_GENERATIONS - 1) {
        break;
      }

      const nextPopulation: PolicyGenome[] = [];
      const elitismCount = Math.max(0, Math.min(env.GA_ELITISM, sorted.length));
      for (let index = 0; index < elitismCount; index += 1) {
        nextPopulation.push(cloneGenome(sorted[index]!.genome));
      }

      while (nextPopulation.length < env.GA_POPULATION_SIZE) {
        const parent1 = tournamentSelect(sorted, 2).genome;
        const parent2 = tournamentSelect(sorted, 3).genome;

        let offspring: PolicyGenome[];
        if (Math.random() < env.GA_CROSSOVER_PROB) {
          offspring = this.crossoverGenome(parent1, parent2);
        } else {
          offspring = [cloneGenome(parent1), cloneGenome(parent2)];
        }

        offspring = offspring.map((child) =>
          Math.random() < env.GA_MUTATION_PROB ? this.mutateGenome(child) : cloneGenome(child),
        );

        for (const child of offspring) {
          if (nextPopulation.length < env.GA_POPULATION_SIZE) {
            nextPopulation.push(child);
          }
        }
      }

      population = nextPopulation;

      logger.info(
        {
          generation,
          nextGeneration: generation + 2,
          newPopulationSize: nextPopulation.length,
          elitismCount
        },
        `📊 Breeding Next Generation - ${nextPopulation.length} individuals created (${elitismCount} elite carried over)`,
      );
    }

    logger.info(
      {
        totalGenerations: env.GA_GENERATIONS,
        finalPopulationSize: population.length
      },
      '='.repeat(80),
    );
    logger.info(
      {
        totalGenerations: env.GA_GENERATIONS,
        finalPopulationSize: population.length
      },
      `🎉 GA RUN COMPLETE - ${env.GA_GENERATIONS} generations finished!`,
    );
  }
}
