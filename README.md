# Turborepo Phaser Turn-Based Demo

A pnpm + Turborepo monorepo that wires together a Next.js 15 client (with Phaser 3), a Socket.IO authoritative server, and shared TypeScript packages. Anonymous players can create and join two-player lobbies, take alternating turns with a 10 second timeout, and persist lobby snapshots to SQLite via Prisma.

## Tech stack

- **Apps**
  - `apps/web` – Next.js 15 (App Router) + Tailwind + shadcn/ui + Phaser 3 (client only)
  - `apps/socket` – Node Socket.IO server with per-lobby mutexes and pino logging
- **Packages**
  - `packages/shared` – Zod schemas, protocol helpers, constants
  - `packages/db` – Prisma Client + SQLite schema and helpers
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
pnpm migrate # runs Prisma migrations via @repo/db
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

| Event              | Direction        | Payload summary                                                                 |
| ------------------ | ---------------- | ----------------------------------------------------------------------------- |
| `lobby:create`     | client → server  | `{ name, password?, isPrivate? }`                                             |
| `lobby:list`       | both             | Request `{ page, pageSize }` – Response `{ items, page, total }`              |
| `lobby:join`       | client → server  | `{ lobbyId, password? }`                                                      |
| `lobby:leave`      | client → server  | `{ lobbyId }`                                                                 |
| `lobby:start`      | client → server  | `{ lobbyId }`                                                                 |
| `turn:pass`        | client → server  | `{ lobbyId }` (legacy alias for `game:endTurn`)                               |
| `game:placeUnit`   | client → server  | `{ lobbyId, type, x, y }` – places a unit on the invoking player’s half       |
| `game:moveUnit`    | client → server  | `{ lobbyId, unitId, toX, toY }` – Manhattan move respecting unit range       |
| `game:endTurn`     | client → server  | `{ lobbyId }` – swaps the active player and refreshes mana                    |
| `state:sync`       | server → client  | `{ lobby, match }` snapshot (board state, mana, units, optional winner)       |
| `error`            | server → client  | `{ code, message }`                                                           |

## Gameplay notes

- Two players face off on an authoritative **8×8 board**. Coordinates start at the top-left corner `(0,0)` with flags anchored at `(0,0)` for player A and `(7,7)` for player B.
- Each unit costs mana to summon: Mage (3), Warrior (2), Archer (2). Mana resets to **5** for the active player at the start of every turn and cannot be banked.
- Summons are restricted to the summoner’s half of the board (`y ∈ [0..3]` for the top player, `y ∈ [4..7]` for the bottom player) and a cell must be empty.
- Newly summoned units suffer **summoning sickness** and cannot move until the next turn.
- Movement uses Manhattan distance and is capped per type: Mage (2), Warrior (1), Archer (3). Units may pass through others but cannot end on an occupied cell or remain still.
- Reaching the opponent’s flag instantly wins the match. There is no combat in this MVP.
- The socket server is fully authoritative: every placement, move, and turn end is validated under a per-lobby mutex before persisting to SQLite via Prisma.
- Empty lobbies are reaped after 5 minutes, and snapshots are restored on boot so matches survive restarts.

### Manual test flow

1. Start the stack with `pnpm dev` and open two browser windows.
2. Create a lobby in one window and join it from the other; wait for the server to auto-assign the starting player.
3. Use the **Summon** buttons to place units on your side, observing mana deductions and the inability to act on the enemy half.
4. Attempt to move a freshly summoned unit to confirm summoning sickness is enforced.
5. Move an eligible unit using Manhattan distance, ensuring it cannot finish on occupied cells and that highlighted tiles match server validation.
6. Click **End Turn** to swap the active player and verify mana resets for the new turn owner.
7. Walk a unit onto the opponent’s flag and confirm the victory banner appears and subsequent actions are rejected.
8. Restart the socket process and reconnect clients to see the persisted match state reloaded from SQLite.

## Available scripts

| Script        | Description                                      |
| ------------- | ------------------------------------------------ |
| `pnpm dev`    | Run socket + web apps in parallel via Turborepo  |
| `pnpm build`  | Build all workspaces                              |
| `pnpm test`   | Run Jest suites (reducers/state helpers)          |
| `pnpm lint`   | Lint all packages with ESLint                     |
| `pnpm typecheck` | Type-check using project references            |
| `pnpm migrate`   | Apply Prisma migrations                        |

## License

[MIT](./LICENSE)
