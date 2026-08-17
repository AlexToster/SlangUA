import pino from 'pino';
import { config } from '../config/index.js';

/**
 * Shared application logger for code that runs outside a request scope
 * (services, adapters, infrastructure clients).
 *
 * Inside a route handler prefer `request.log` - it carries the request id.
 * Direct `console.*` calls are not allowed anywhere except `src/config`,
 * which must be able to report a fatal misconfiguration before this module
 * (and therefore the validated config it depends on) can exist.
 *
 * Transport mirrors the Fastify logger in `src/app.ts` so that a single
 * LOG_LEVEL setting controls both.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  transport: config.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  } : undefined,
});
