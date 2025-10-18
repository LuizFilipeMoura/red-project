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

### Server architecture

The socket server uses a **clean event-driven architecture** with the following patterns:

- **Handler pattern**: Each event has a handler definition with optional `preProcess`, `handler`, and `postProcess` hooks
- **Preprocessing validation**: Game actions (`placeUnit`, `moveUnit`, `endTurn`) use preprocessing to validate state and acquire mutex locks before execution
- **Per-lobby mutex**: Each lobby has its own async mutex to prevent race conditions during concurrent operations
- **Authoritative validation**: All game rules are validated server-side; the client is purely presentational
- **Stateful broadcasting**: Each client receives their session ID (`yourSid`) in state sync messages to determine turn ownership and enable/disable UI controls

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
| `turn:pass`        | client → server  | `{ lobbyId }` – passes turn (internally delegates to `game:endTurn`)          |
| `game:placeUnit`   | client → server  | `{ lobbyId, type, x, y }` – places a unit on the invoking player's half       |
| `game:moveUnit`    | client → server  | `{ lobbyId, unitId, toX, toY }` – Manhattan move respecting unit range       |
| `game:endTurn`     | client → server  | `{ lobbyId }` – swaps the active player and refreshes mana                    |
| `state:sync`       | server → client  | `{ lobby, match, yourSid? }` – snapshot with board state, mana, units, winner, and your session ID |
| `error`            | server → client  | `{ code, message }`                                                           |

## Gameplay notes

- Two players face off on an authoritative **8×8 board**. Coordinates start at the top-left corner `(0,0)` with flags anchored at `(0,0)` for player A and `(7,7)` for player B.
- **Flag markers** are visually rendered on the board to indicate each player's home position and victory target.
- Each unit costs mana to summon: Mage (3), Warrior (2), Archer (2). Mana resets to **5** for the active player at the start of every turn and cannot be banked.
- Summons are restricted to the summoner's half of the board (`y ∈ [0..3]` for the top player, `y ∈ [4..7]` for the bottom player) and a cell must be empty.
- Newly summoned units suffer **summoning sickness** and cannot move until the next turn.
- Movement uses Manhattan distance and is capped per type: Mage (2), Warrior (1), Archer (3). Units may pass through others but cannot end on an occupied cell or remain still.
- Reaching the opponent's flag instantly wins the match. There is no combat in this MVP.
- The socket server is fully authoritative: every placement, move, and turn end is validated under a per-lobby mutex before persisting to SQLite via Prisma.
- **Turn-based enforcement**: The client UI automatically disables all controls (summon buttons, end turn button, tile clicks) when it's not the active player's turn, providing clear visual feedback.
- **Automatic navigation**: Players are automatically redirected from the lobby page to the game page when a match starts.
- Empty lobbies are reaped after 5 minutes, and snapshots are restored on boot so matches survive restarts.

### Manual test flow

1. Start the stack with `pnpm dev` and open two browser windows.
2. Create a lobby in one window and join it from the other.
3. Click **Start match** when both players have joined – both clients will automatically redirect to the game page with the Phaser board visible.
4. Observe the **flag markers** (A and B) rendered on the board at positions `(0,0)` and `(7,7)`.
5. Verify the **"(Your turn!)"** indicator appears for the active player, while the other player sees all controls disabled.
6. Use the **Summon** buttons to place units on your side, observing mana deductions and the inability to act on the enemy half.
7. Attempt to move a freshly summoned unit to confirm summoning sickness is enforced.
8. Move an eligible unit using Manhattan distance, ensuring it cannot finish on occupied cells and that highlighted tiles match server validation.
9. Click **End Turn** to swap the active player and verify:
   - Mana resets for the new turn owner
   - Controls become enabled for the new active player
   - Controls become disabled for the player who just ended their turn
10. Walk a unit onto the opponent's flag and confirm the victory banner appears and all subsequent actions are rejected.
11. Restart the socket process and reconnect clients to see the persisted match state reloaded from SQLite.

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
