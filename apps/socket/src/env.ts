import 'dotenv/config';

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  COOKIE_SECRET: process.env.COOKIE_SECRET ?? 'dev-secret',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  GA_MONITOR_TOKEN: process.env.GA_MONITOR_TOKEN ?? '',
  GA_EMITTER_TOKEN: process.env.GA_EMITTER_TOKEN ?? '',
  GA_UPDATE_THROTTLE_MS: Number(process.env.GA_UPDATE_THROTTLE_MS ?? 500),
  GA_UPDATE_MAX_BYTES: Number(process.env.GA_UPDATE_MAX_BYTES ?? 4_096),
  GA_DATA_DIR: process.env.GA_DATA_DIR ?? 'apps/ga/data',
  GA_REPLAY_MAX_PARALLEL: Number(process.env.GA_REPLAY_MAX_PARALLEL ?? 1),
  GA_REPLAY_FRAME_INTERVAL_MS: Number(process.env.GA_REPLAY_FRAME_INTERVAL_MS ?? 150),
  GA_ENGINE_VERSION: process.env.GA_ENGINE_VERSION ?? '1.0.0',
};
