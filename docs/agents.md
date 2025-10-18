# Agents Documentation

## Overview

This document describes the agent/event handler architecture used in the socket server application. The system uses a clean architecture pattern with pre-processing and post-processing hooks for all event handlers.

## Architecture

### Event Handler Lifecycle

Every event handler follows a three-phase lifecycle:

```
Pre-Process → Main Handler → Post-Process
```

1. **Pre-Process**: Validation, logging, and setup
2. **Main Handler**: Core business logic
3. **Post-Process**: Cleanup, logging, and notifications

### Type Definitions

Located in `apps/socket/src/application/types.ts`:

```typescript
// Pre-process hook interface
export interface PreProcessEvent<TInput = unknown> {
  preProcess?: (context: HandlerContext, input: TInput) => Promise<void> | void;
}

// Post-process hook interface
export interface PostProcessEvent<TInput = unknown> {
  postProcess?: (context: HandlerContext, input: TInput) => Promise<void> | void;
}

// Combined lifecycle interface
export interface EventLifecycle<TInput = unknown>
  extends PreProcessEvent<TInput>, PostProcessEvent<TInput> {
  handler: EventHandler<TInput>;
}
```

### Handler Context

All handlers receive a `HandlerContext` object with:

```typescript
export type HandlerContext = {
  db: PrismaClient;              // Database client
  store: LobbyStore;             // In-memory lobby store
  socket: Socket;                // Socket.IO socket instance
  sid: string;                   // Session ID from cookie
  logger: Logger;                // Pino logger instance
  emitError: (code: string, message: string) => void;
  joinLobbyRoom: (lobbyId: string) => Promise<void> | void;
  leaveLobbyRoom: (lobbyId: string) => Promise<void> | void;
  broadcastState: (lobby: LobbyState) => Promise<void>;
  scheduleTurnTimeout: (lobby: LobbyState, duration?: number) => void;
  clearLobbyTimeout: (lobbyId: string) => void;
  checkRateLimit: (event: string) => boolean;
  parsePayload: <T>(event: keyof typeof schemas, payload: unknown, schema: z.ZodType<T>) => T;
};
```

## Event Handlers

### Available Events

| Event | Description | Request Schema | Response |
|-------|-------------|----------------|----------|
| `lobby:create` | Create a new lobby | `{name, password?, isPrivate?}` | `state:sync` |
| `lobby:list` | List available lobbies | `{page, pageSize}` | `lobby:list` response |
| `lobby:join` | Join an existing lobby | `{lobbyId, password?}` | `state:sync` |
| `lobby:leave` | Leave a lobby | `{lobbyId}` | `state:sync` |
| `lobby:start` | Start a game | `{lobbyId}` | `state:sync` |
| `turn:pass` | Pass turn to next player | `{lobbyId}` | `state:sync` |
| `state:sync` | State synchronization (server→client) | N/A | `{lobby}` |
| `error` | Error notification (server→client) | N/A | `{code, message}` |

### Creating a New Handler

#### 1. Define the Handler

Create a new file in `apps/socket/src/application/handlers/`:

```typescript
import { EVENTS, schemas } from '@repo/shared';
import type { z } from 'zod';
import { ApplicationError } from '../errors.js';
import type { EventHandler, HandlerContext } from '../types.js';

const schema = schemas[EVENTS.YOUR_EVENT];
type YourEventInput = z.infer<typeof schema>;

// Pre-process: Validation and logging
const preProcessYourEvent = async (context: HandlerContext, input: YourEventInput) => {
  context.logger.info({ input }, 'Pre-processing your event');

  // Validate permissions, check existence, etc.
  if (/* some validation */) {
    throw new ApplicationError('FORBIDDEN', 'Not allowed');
  }
};

// Main handler: Core business logic
export const handleYourEvent: EventHandler<YourEventInput> = async (context, input) => {
  // Implement your core logic here
  const result = await context.db.someModel.create({ data: input });

  // Broadcast updates
  await context.broadcastState(someLobby);
};

// Post-process: Logging and cleanup
const postProcessYourEvent = async (context: HandlerContext, input: YourEventInput) => {
  context.logger.info({ input }, 'Successfully processed your event');
};

// Export definition
export const yourEventDefinition = {
  event: EVENTS.YOUR_EVENT,
  schema,
  useRateLimit: true,
  preProcess: preProcessYourEvent,
  handler: handleYourEvent,
  postProcess: postProcessYourEvent,
} as const;
```

#### 2. Register the Handler

Add to `apps/socket/src/application/handlers/index.ts`:

```typescript
import { yourEventDefinition } from './yourEvent.js';

export const handlerDefinitions = [
  // ... existing handlers
  yourEventDefinition,
];
```

## Example: Pass Turn Handler

Full example from `apps/socket/src/application/handlers/passTurn.ts`:

```typescript
// Pre-process: Validate lobby exists and player is in the lobby
const preProcessPassTurn = async (context: HandlerContext, input: PassTurnInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  const player = lobby.players.find((p) => p.sid === context.sid);
  if (!player) {
    throw new ApplicationError('FORBIDDEN', 'You are not in this lobby');
  }

  context.logger.info({ lobbyId: input.lobbyId, sid: context.sid }, 'Pre-processing pass turn');
};

// Main handler: Execute the turn pass logic
export const handlePassTurn: EventHandler<PassTurnInput> = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }

  await lobby.mutex.runExclusive(async () => {
    if (lobby.currentPlayerSid !== context.sid) {
      throw new ApplicationError('TURN', 'Not your turn');
    }

    const other = lobby.players.find((player) => player.sid !== context.sid);
    if (!other) {
      throw new ApplicationError('INVALID_STATE', 'No other player found');
    }

    lobby.currentPlayerSid = other.sid;
    lobby.turnNumber += 1;
    context.scheduleTurnTimeout(lobby);
    await context.broadcastState(lobby);
  });
};

// Post-process: Log turn completion
const postProcessPassTurn = async (context: HandlerContext, input: PassTurnInput) => {
  const lobby = context.store.get(input.lobbyId);
  if (lobby) {
    context.logger.info(
      {
        lobbyId: input.lobbyId,
        turnNumber: lobby.turnNumber,
        currentPlayer: lobby.currentPlayerSid,
      },
      'Turn passed successfully',
    );
  }
};
```

## Registry System

The registry (`apps/socket/src/application/registry.ts`) automatically:

1. **Rate limiting**: Checks if enabled and enforces limits
2. **Payload parsing**: Validates input against schema
3. **Pre-process execution**: Runs pre-process hook
4. **Handler execution**: Runs main handler
5. **Post-process execution**: Runs post-process hook
6. **Error handling**: Catches and emits errors to client

```typescript
export const registerHandlers = (
  context: HandlerContext,
  definitions: HandlerDefinition[],
) => {
  for (const definition of definitions) {
    context.socket.on(definition.event, async (payload: unknown) => {
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
        // Error handling...
      }
    });
  }
};
```

## Error Handling

### Application Errors

Use `ApplicationError` for expected errors:

```typescript
throw new ApplicationError('NOT_FOUND', 'Lobby not found');
throw new ApplicationError('FORBIDDEN', 'You are not the owner');
throw new ApplicationError('VALIDATION', 'Invalid input');
```

Common error codes:
- `NOT_FOUND`: Resource doesn't exist
- `FORBIDDEN`: Permission denied
- `VALIDATION`: Invalid input
- `RATE_LIMIT`: Too many requests
- `TURN`: Not player's turn
- `FULL`: Lobby is full
- `PASSWORD`: Invalid password
- `INVALID_STATE`: Invalid game state

### Validation Errors

Zod validation errors are automatically caught and sent to client:

```typescript
const schema = z.object({
  lobbyId: z.string().min(1),
});
```

## Best Practices

### 1. Use Pre-Process for Validation

✅ **Good**: Validate in pre-process
```typescript
const preProcess = async (context, input) => {
  if (!context.store.get(input.lobbyId)) {
    throw new ApplicationError('NOT_FOUND', 'Lobby not found');
  }
};
```

❌ **Bad**: Skip validation
```typescript
const handler = async (context, input) => {
  const lobby = context.store.get(input.lobbyId)!; // Unsafe!
};
```

### 2. Use Post-Process for Logging

✅ **Good**: Log success in post-process
```typescript
const postProcess = async (context, input) => {
  context.logger.info({ lobbyId: input.lobbyId }, 'Action completed');
};
```

❌ **Bad**: Mix logging with business logic
```typescript
const handler = async (context, input) => {
  await doSomething();
  context.logger.info('Done'); // Mixes concerns
};
```

### 3. Use Mutex for Concurrent Operations

✅ **Good**: Use mutex for lobby modifications
```typescript
await lobby.mutex.runExclusive(async () => {
  lobby.players.push(newPlayer);
  await context.broadcastState(lobby);
});
```

❌ **Bad**: Race conditions
```typescript
lobby.players.push(newPlayer);
await context.broadcastState(lobby);
```

### 4. Always Broadcast State Changes

✅ **Good**: Broadcast after state changes
```typescript
lobby.currentPlayerSid = other.sid;
await context.broadcastState(lobby);
```

❌ **Bad**: Forget to broadcast
```typescript
lobby.currentPlayerSid = other.sid;
// Clients won't receive update!
```

## Delayed State Sync Pattern

For reliability, some handlers use delayed broadcasts:

```typescript
const postProcess = async (context, input) => {
  const lobby = context.store.get(input.lobbyId);
  if (!lobby) return;

  // Broadcast state again after delays to ensure client receives it
  setTimeout(async () => {
    await context.broadcastState(lobby);
  }, 100);

  setTimeout(async () => {
    await context.broadcastState(lobby);
  }, 1000);
};
```

This ensures clients receive state updates even with network delays.

## Testing

### Manual Testing

1. Start socket server: `pnpm --filter socket dev`
2. Start web client: `pnpm --filter web dev`
3. Open browser console to see logs
4. Check server logs for handler execution

### Unit Testing

```typescript
describe('handlePassTurn', () => {
  it('should pass turn to next player', async () => {
    const context = createMockContext();
    const input = { lobbyId: 'test-123' };

    await handlePassTurn(context, input);

    expect(lobby.currentPlayerSid).toBe(otherPlayer.sid);
    expect(lobby.turnNumber).toBe(2);
  });
});
```

## Debugging

### Enable Debug Logs

Check server console for:
- Pre-process logs
- Handler execution
- Post-process logs
- State broadcasts

### Common Issues

**Issue**: Client not receiving state updates
- ✅ Check if `broadcastState` is called
- ✅ Check if client joined lobby room
- ✅ Check if socket is connected

**Issue**: Race conditions
- ✅ Use `lobby.mutex.runExclusive()`
- ✅ Check for concurrent modifications

**Issue**: Validation errors
- ✅ Check schema definitions
- ✅ Check client payload format

## Resources

- [Socket.IO Documentation](https://socket.io/docs/)
- [Zod Schema Validation](https://zod.dev/)
- [Pino Logger](https://github.com/pinojs/pino)
- [Async Mutex](https://github.com/DirtyHairy/async-mutex)
