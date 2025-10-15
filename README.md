# Turborepo Phaser Turn-Based Demo

A pnpm + Turborepo monorepo that wires together a Next.js 15 client (with Phaser 3), a Socket.IO authoritative server, and shared TypeScript packages. Anonymous players can create and join two-player lobbies, take alternating turns with a 10 second timeout, and persist lobby snapshots to SQLite via Drizzle ORM.

## Tech stack

- **Apps**
  - `apps/web` – Next.js 15 (App Router) + Tailwind + shadcn/ui + Phaser 3 (client only)
  - `apps/socket` – Node Socket.IO server with per-lobby mutexes and pino logging
- **Packages**
  - `packages/shared` – Zod schemas, protocol helpers, constants
  - `packages/db` – Drizzle ORM + SQLite schema, migrations, helpers
- Tooling: Turborepo, pnpm, ESLint, Prettier, Jest, Husky + lint-staged

## Quick architecture

```
┌───────────────┐   Socket.IO JSON events    ┌───────────────┐
│   Next.js UI  │◀──────────────────────────▶│  Socket host  │
│ (Phaser HUD)  │                            │  (Node + DB)  │
└──────┬────────┘                            └──────┬────────┘
       │                                           │
       │ Shared protocol + schemas (packages/shared│
       ▼                                           ▼
   Phaser grid                            SQLite snapshots (packages/db)
```

## Getting started

```bash
pnpm install
pnpm migrate # generates + runs drizzle migrations (sqlite.db)
```

### Development

```bash
pnpm dev
```

- Web UI → http://localhost:3000
- Socket server → http://localhost:4000 (`/game` namespace)

### Production build

```bash
pnpm build
```

### Quality gates

```bash
pnpm lint
pnpm test
pnpm typecheck
```

## Environment

Create `.env` files based on the provided examples:

- `apps/socket/.env.example`
- `apps/web/.env.local.example`

The socket issues a signed `sid` cookie (`HttpOnly`, `SameSite=Lax`, `secure` in production).

## Event catalogue

| Event            | Direction        | Payload summary                                                     |
| ---------------- | ---------------- | ------------------------------------------------------------------- |
| `lobby:create`   | client → server  | `{ name, password?, isPrivate? }`                                   |
| `lobby:list`     | both             | Request `{ page, pageSize }` – Response `{ items, page, total }`    |
| `lobby:join`     | client → server  | `{ lobbyId, password? }`                                            |
| `lobby:leave`    | client → server  | `{ lobbyId }`                                                       |
| `lobby:start`    | client → server  | `{ lobbyId }`                                                       |
| `turn:pass`      | client → server  | `{ lobbyId }` (only active player succeeds)                         |
| `state:sync`     | server → client  | `{ lobby }` snapshot (includes players, turnNumber, deadlineAt)     |
| `error`          | server → client  | `{ code, message }`                                                 |

## Gameplay notes

- Lobbies are public by default, optional password makes them private.
- Maximum of 2 players; once full the server randomly chooses the starting player and locks the room for new joins.
- Each turn has a 10 second timeout – the server auto-passes when it elapses.
- Authoritative lobby state lives in-memory with every mutation snapshotted to SQLite and restored on boot.
- Empty lobbies are reaped after 5 minutes of inactivity.
- Simple per-socket rate limiting protects critical lobby events.

## Available scripts

| Script        | Description                                      |
| ------------- | ------------------------------------------------ |
| `pnpm dev`    | Run socket + web apps in parallel via Turborepo  |
| `pnpm build`  | Build all workspaces                              |
| `pnpm test`   | Run Jest suites (reducers/state helpers)          |
| `pnpm lint`   | Lint all packages with ESLint                     |
| `pnpm typecheck` | Type-check using project references            |
| `pnpm migrate`   | Generate and apply Drizzle migrations          |

## License

[MIT](./LICENSE)
