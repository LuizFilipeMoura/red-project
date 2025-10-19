import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { GaSnapshot } from '@repo/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { gaTelemetryStore } from './telemetryStore.js';

export async function loadHistoricalGenerations(): Promise<void> {
  const filePath = `${env.GA_DATA_DIR}/generations.jsonl`;

  if (!existsSync(filePath)) {
    logger.info({ filePath }, 'No historical generations file found, starting fresh');
    return;
  }

  try {
    logger.info({ filePath }, 'Loading historical generations from JSONL');

    const content = await readFile(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);

    let loaded = 0;
    let errors = 0;

    for (const line of lines) {
      try {
        const snapshot = JSON.parse(line) as GaSnapshot;
        // Load into telemetry store with a synthetic SID
        gaTelemetryStore.set(snapshot, 'historical');
        loaded++;
      } catch (error) {
        logger.error({ error, line: line.slice(0, 100) }, 'Failed to parse generation line');
        errors++;
      }
    }

    logger.info(
      {
        filePath,
        totalLines: lines.length,
        loaded,
        errors,
        oldestGen: loaded > 0 ? JSON.parse(lines[0]!).gen : undefined,
        latestGen: loaded > 0 ? JSON.parse(lines[lines.length - 1]!).gen : undefined,
      },
      'Historical generations loaded into telemetry store',
    );
  } catch (error) {
    logger.error({ err: error, filePath }, 'Failed to load historical generations');
  }
}
