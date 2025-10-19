import type { GaSnapshot } from '@repo/shared';

export type PolicyGenome = {
  aggression: number;
  caution: number;
  tempo: number;
  noise: number;
};

export type EpisodeResult = {
  gen: number;
  seed: string;
  win: boolean;
  turns: number;
  score: number;
  weightsHash: string;
  engineVersion: string;
  policyVersion: string;
  traceRef?: string;
};

export type GenerationTelemetry = GaSnapshot;

export type IndividualStats = {
  weightsHash: string;
  fitness: number;
  mean: number;
  p90: number;
  variance: number;
  sampleSize: number;
  winRate: number;
  entropy: number;
};
