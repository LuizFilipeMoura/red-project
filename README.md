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
- **Preprocessing validation**: Card and board actions (`card:playUnit`, `card:playSpell`, `card:playTalent`, `game:moveUnit`, `game:endTurn`) use preprocessing to validate state and acquire mutex locks before execution
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
| `card:playUnit`    | client → server  | `{ lobbyId, cardId, x, y }` – summons a unit card on the owner's half         |
| `card:playSpell`   | client → server  | `{ lobbyId, cardId, anchorX, anchorY }` – resolves spell area effects        |
| `card:playTalent`  | client → server  | `{ lobbyId, cardId, targetX, targetY }` – fires an expiring per-unit talent  |
| `game:moveUnit`    | client → server  | `{ lobbyId, unitId, toX, toY }` – Manhattan move respecting unit range       |
| `game:endTurn`     | client → server  | `{ lobbyId }` – swaps the active player, expires talents, refreshes mana     |
| `state:sync`       | server → client  | `{ lobby, match, yourSid? }` – snapshot with decks, cards, units, mana, winner, and your session ID |
| `error`            | server → client  | `{ code, message }`                                                           |

## Gameplay notes

- Two players face off on an authoritative **8×8 board**. Coordinates start at the top-left corner `(0,0)` with flags anchored at `(0,0)` for player A and `(7,7)` for player B.
- **Deckbuilder core**: each player starts with a **20-card deck** mixing Unit and Spell cards. There is no mulligan. At the beginning of their turn they **draw exactly one card**, refresh mana, and receive talent cards for each living unit they control.
- **Mana economy**: Mana is the only resource, reset to **5** for the active player every turn with no carry-over. Unit costs follow `Mage 3 / Warrior 2 / Archer 2`; spell costs vary per card; talents always cost 1.
- **Summons**: Unit cards may only be deployed on the owner's side (`y ∈ [0..3]` for player A, `y ∈ [4..7]` for player B`) and require an empty cell. Units enter play with **summoning sickness** (cannot move until the next turn) and with their base `hp/hpMax` values.
- **Spell system**: Spell cards target board areas (`cell`, `row`, `column`, `square2x2`, or diagonals with configurable length). Effects include damage, healing, and `maxHpUp`, and each card decides whether friendly fire is allowed.
- **Talents**: At the start of a player's turn every surviving unit grants one talent card bound to that unit. Talents cost 1 mana, expire at the end of the turn, and replace any existing talent from the same unit. They can be aimed freely within the unit's talent range and immediately consumed on use.
- **Unit health**: Units now track `hp` and `hpMax`. Damage reduces `hp` and removes the unit (and its talents) at `hp <= 0`. Healing never exceeds `hpMax`, while `maxHpUp` increases the ceiling without automatically restoring health.
- **Movement**: Still uses Manhattan distance per type (Mage 2, Warrior 1, Archer 3). Units may pass through others but cannot end on occupied cells or stand still.
- **Victory**: Entering the opponent's flag instantly wins the match. All actions remain server-authoritative with per-lobby mutex enforcement and automatic persistence to SQLite.
- **Client UX**: The Phaser HUD highlights valid deployment cells, spell areas under the cursor, and talent ranges. The deck viewer exposes deck/hand/discard/graveyard, while the talent panel lists per-unit abilities available this turn.
- Empty lobbies are reaped after 5 minutes, snapshots are restored on boot, and the UI continues to auto-disable controls when it's not your turn.

### Manual test flow

1. Start the stack with `pnpm dev` and open two browser windows.
2. Create a lobby in one window and join it from the other.
3. Click **Start match** when both players have joined – both clients redirect to the game view. Confirm the first player draws one card, receives 5 mana, and sees an empty talent panel.
4. Open the deck viewer and verify deck/hand/discard/graveyard counts update as cards are drawn or played.
5. Select a **Unit** card: the board should highlight valid cells only on your side. Play it and confirm mana decreases, the card moves to the graveyard, and the unit appears with the correct HP.
6. Attempt to deploy a unit on the opponent's half or on an occupied cell to ensure the server rejects the action and a toast error appears.
7. Play a **Spell** card and watch the preview follow your cursor. Test both damage and healing spells, confirming friendly-fire rules are respected and defeated units vanish.
8. End the turn. Verify talents expire, mana resets for the old player, the opponent draws a card, and talents are generated for any of their surviving units.
9. Use a **Talent** card to damage an enemy unit within range and confirm the talent disappears from your panel afterward.
10. Move units using Manhattan range and ensure summoning sickness prevents moving immediately after deployment.

### Troubleshooting

- **Offline/Corepack environments** – Corepack may attempt to download `pnpm@9.0.0` on first use. If the network is blocked, inst
  all pnpm manually (for example, copy a cached binary) or set `COREPACK_ENABLE_NETWORK=0` alongside a locally available pnpm rel
  ease before running `pnpm install`, Prisma migrations, or test scripts.
11. Continue alternating turns until a unit reaches the opponent's flag; verify the victory banner appears and further actions are blocked.
12. Restart the socket server and reconnect both clients to confirm the match state (including decks, units, and HP) persists from SQLite.

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
