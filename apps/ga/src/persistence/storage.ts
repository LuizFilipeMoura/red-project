import { mkdir, stat, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { GaSnapshot } from '@repo/shared';
import { env } from '../env.js';
import type { PolicyGenome, EpisodeResult } from '../types.js';
import { logger } from '../logger.js';

const ensureDir = async (dir: string) => {
  try {
    const info = await stat(dir);
    if (info.isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await mkdir(dir, { recursive: true });
  }
};

const appendJsonl = async (filePath: string, data: unknown) => {
  const line = `${JSON.stringify(data)}\n`;
  await appendFile(filePath, line, { encoding: 'utf8' });
};

export const ensureStorage = async () => {
  await ensureDir(env.GA_DATA_DIR);
  await ensureDir(path.dirname(env.GA_GENERATIONS_PATH));
  await ensureDir(path.dirname(env.GA_EPISODES_PATH));
  await ensureDir(env.GA_WEIGHTS_DIR);
  await ensureDir(env.GA_TRACES_DIR);
};

export const hashWeights = (genome: PolicyGenome) =>
  createHash('sha256').update(JSON.stringify(genome)).digest('hex');

export const saveWeights = async (genome: PolicyGenome, hash: string) => {
  const target = path.resolve(env.GA_WEIGHTS_DIR, `weights-${hash}.json`);
  await writeFile(target, JSON.stringify({ genome }, null, 2), 'utf8');
  return target;
};

export const persistGeneration = async (snapshot: GaSnapshot) => {
  await appendJsonl(env.GA_GENERATIONS_PATH, snapshot);
};

export const persistEpisodes = async (episodes: EpisodeResult[]) => {
  for (const episode of episodes) {
    await appendJsonl(env.GA_EPISODES_PATH, episode);
  }
};

export const persistTrace = async (
  gen: number,
  seed: string,
  frames: { frame: number; timestamp: number; match: unknown; action?: { type: string; payload: unknown } }[],
) => {
  if (!env.GA_REPLAY_TRACE_ENABLED) {
    return undefined;
  }
  const fileName = `trace-${gen}-${seed}.jsonl`;
  const fullPath = path.resolve(env.GA_TRACES_DIR, fileName);
  await ensureDir(path.dirname(fullPath));
  const body = frames.map((frame) => JSON.stringify(frame)).join('\n');
  await writeFile(fullPath, `${body}\n`, 'utf8');
  logger.debug({ gen, seed, frames: frames.length }, 'Persisted trace');
  return path.relative(env.GA_DATA_DIR, fullPath);
};
