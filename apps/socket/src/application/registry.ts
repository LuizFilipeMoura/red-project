import { z } from 'zod';
import { schemas } from '@repo/shared';
import type { HandlerContext, EventHandler, PreProcessEvent, PostProcessEvent } from './types.js';
import { ApplicationError } from './errors.js';

export type HandlerDefinition = {
  event: keyof typeof schemas;
  schema?: z.ZodTypeAny;
  useRateLimit?: boolean;
  handler: EventHandler<any>;
  preProcess?: PreProcessEvent<any>['preProcess'];
  postProcess?: PostProcessEvent<any>['postProcess'];
};

export const registerHandlers = (
  context: HandlerContext,
  definitions: HandlerDefinition[],
) => {
  for (const definition of definitions) {
    context.socket.on(definition.event, async (payload: unknown) => {
      context.logger.debug(
        {
          event: definition.event,
          sid: context.sid,
          socketId: context.socket.id,
          hasPayload: !!payload,
        },
        'Event received',
      );

      try {
        if (definition.useRateLimit && !context.checkRateLimit(definition.event)) {
          throw new ApplicationError('RATE_LIMIT', 'Too many requests');
        }
        const input = definition.schema
          ? context.parsePayload(definition.event, payload, definition.schema)
          : payload;

        // Pre-process hook
        if (definition.preProcess) {
          await definition.preProcess(context, input);
        }

        // Main handler
        await definition.handler(context, input);

        // Post-process hook
        if (definition.postProcess) {
          await definition.postProcess(context, input);
        }
      } catch (error) {
        if (error instanceof ApplicationError) {
          context.emitError(error.code, error.message);
          return;
        }
        if (error instanceof z.ZodError) {
          context.emitError('VALIDATION', error.message);
          return;
        }
        context.logger.error(
          { err: error, event: definition.event, sid: context.sid },
          'Unhandled event handler error',
        );
        context.emitError('INTERNAL', 'Unexpected error');
      }
    });
  }
};
