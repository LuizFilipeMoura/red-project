import { z } from 'zod';
import { schemas } from './schemas.js';
import { VERSION } from './constants.js';

export type Version = typeof VERSION;
export type EventType = keyof typeof schemas;

export type Message<T extends EventType = EventType> = {
  version: Version;
  type: T;
  payload: z.infer<(typeof schemas)[T]>;
};

export const makeMsg = <T extends EventType>(
  type: T,
  payload: z.infer<(typeof schemas)[T]>,
): Message<T> => ({
  version: VERSION,
  type,
  payload,
});

export const validateMessage = (value: unknown) =>
  z
    .object({
      version: z.literal(VERSION),
      type: z.enum(Object.keys(schemas) as [EventType, ...EventType[]]),
      payload: z.unknown(),
    })
    .superRefine((data, ctx) => {
      const schema = schemas[data.type];
      const result = schema.safeParse(data.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue(issue);
        }
      }
    })
    .parse(value);
