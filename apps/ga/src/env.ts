import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  GA_SOCKET_URL: z.string().default('http://localhost:4000/game'),
  GA_MONITOR_TOKEN: z.string().default('dev-monitor-token'),
  GA_EMITTER_TOKEN: z.string().default('dev-emitter-token'),
  GA_DATA_DIR: z.string().default('apps/ga/data'),
  GA_GENERATIONS_PATH: z.string().default('apps/ga/data/generations.jsonl'),
  GA_EPISODES_PATH: z.string().default('apps/ga/data/episodes.jsonl'),
  GA_WEIGHTS_DIR: z.string().default('apps/ga/data/best'),
  GA_TRACES_DIR: z.string().default('apps/ga/data/traces'),
  GA_POPULATION_SIZE: z.coerce.number().int().min(1).default(40),
  GA_GENERATIONS: z.coerce.number().int().min(1).default(60),
  GA_ELITISM: z.coerce.number().int().min(0).default(8),
  GA_MUTATION_PROB: z.coerce.number().min(0).max(1).default(0.35),
  GA_CROSSOVER_PROB: z.coerce.number().min(0).max(1).default(0.6),
  GA_SEED_COUNT: z.coerce.number().int().min(1).max(10).default(3),
  GA_EPISODE_MAX_TURNS: z.coerce.number().int().min(1).default(90),
  GA_ALPHA: z.coerce.number().min(0).default(0.1),
  GA_BETA: z.coerce.number().min(0).default(0.2),
  GA_POLICY_VERSION: z.string().default('ga-policy-v1'),
  GA_ENGINE_VERSION: z.string().default('1.0.0'),
  GA_TRACE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  GA_REPLAY_TRACE_ENABLED: z
    .union([z.string(), z.boolean()])
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      if (!value) return false;
      return value === 'true';
    })
    .default(true),
  GA_ACTION_DELAY_MS: z.coerce.number().int().min(0).default(100),
});

export const env = envSchema.parse(process.env);
