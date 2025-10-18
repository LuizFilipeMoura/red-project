'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { EndTurnPayload, ErrorPayload, Lobby, MatchState, PlaceUnitPayload } from '@repo/shared';
import {
  BOARD_H,
  BOARD_W,
  EVENTS,
  MANA_PER_TURN,
  MOVE_RANGE,
  SIDE_ROWS,
  UNIT_COST,
  type MoveUnitPayload,
} from '@repo/shared';
import {
  endTurn,
  joinLobby,
  moveUnit,
  placeUnit,
  socketClient,
} from '../../../lib/socket';
import { Button } from '../../../components/ui/button';
import type * as PhaserType from 'phaser';

type Mode =
  | { kind: 'idle' }
  | { kind: 'spawn'; unitType: keyof typeof UNIT_COST }
  | { kind: 'move'; unitId: string };

type Highlight = { x: number; y: number; color: number };

type TileCoords = { x: number; y: number };

type PlayerSide = 'A' | 'B';

const getPlayerSide = (lobby: Lobby | null, sid: string): PlayerSide | null => {
  if (!lobby) return null;
  if (lobby.players.length < 2) return null;
  const sorted = [...lobby.players].sort(
    (a, b) => new Date(a.joinedAt).valueOf() - new Date(b.joinedAt).valueOf(),
  );
  if (sorted[0]?.sid === sid) return 'A';
  if (sorted[1]?.sid === sid) return 'B';
  return null;
};

const computeSpawnCells = (
  lobby: Lobby | null,
  match: MatchState | null,
  unitType: keyof typeof UNIT_COST,
): Highlight[] => {
  if (!lobby || !match) return [];
  const side = getPlayerSide(lobby, match.currentPlayerSid);
  if (!side) return [];
  const rows = SIDE_ROWS[side];
  const cells: Highlight[] = [];
  for (let y = rows.min; y <= rows.max; y += 1) {
    for (let x = 0; x < BOARD_W; x += 1) {
      const occupied = match.units.some((unit) => unit.x === x && unit.y === y);
      if (!occupied) {
        cells.push({ x, y, color: 0x22c55e });
      }
    }
  }
  return cells;
};

const computeMoveCells = (match: MatchState | null, unitId: string): Highlight[] => {
  if (!match) return [];
  const unit = match.units.find((u) => u.id === unitId);
  if (!unit) return [];
  const cells: Highlight[] = [];
  const range = MOVE_RANGE[unit.type];
  for (let y = 0; y < BOARD_H; y += 1) {
    for (let x = 0; x < BOARD_W; x += 1) {
      const distance = Math.abs(unit.x - x) + Math.abs(unit.y - y);
      if (distance === 0 || distance > range) continue;
      const occupied = match.units.some((other) => other.id !== unit.id && other.x === x && other.y === y);
      if (!occupied) {
        cells.push({ x, y, color: 0x38bdf8 });
      }
    }
  }
  return cells;
};

type SceneApi = PhaserType.Scene & {
  renderMatch: (match: MatchState | null) => void;
  setHighlights: (cells: Highlight[]) => void;
};

export default function GamePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const phaserRef = useRef<PhaserType.Game | null>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const tileHandlerRef = useRef<(coords: TileCoords) => void>(() => undefined);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });

  useEffect(() => {
    const lobbyId = params?.id;
    if (!lobbyId) return;
    joinLobby(lobbyId);
    const unsubSync = socketClient.on<{ lobby: Lobby; match: MatchState | null }>(
      EVENTS.STATE_SYNC,
      (payload) => {
        if (payload.lobby.id !== lobbyId) return;
        setLobby(payload.lobby);
        setMatch(payload.match);
      },
    );
    const unsubError = socketClient.on<ErrorPayload>(EVENTS.ERROR, (payload) => {
      toast.error(payload.message);
    });
    return () => {
      unsubSync?.();
      unsubError?.();
    };
  }, [params?.id]);

  useEffect(() => {
    tileHandlerRef.current = (coords: TileCoords) => {
      if (!match || !params?.id) return;
      if (mode.kind === 'spawn') {
        const spawnable = computeSpawnCells(lobby, match, mode.unitType).some(
          (cell) => cell.x === coords.x && cell.y === coords.y,
        );
        if (spawnable) {
          const payload: PlaceUnitPayload = {
            lobbyId: params.id,
            type: mode.unitType,
            x: coords.x,
            y: coords.y,
          };
          placeUnit(payload);
          setMode({ kind: 'idle' });
        }
        return;
      }

      if (mode.kind === 'move') {
        const movable = computeMoveCells(match, mode.unitId).some(
          (cell) => cell.x === coords.x && cell.y === coords.y,
        );
        if (movable) {
          const payload: MoveUnitPayload = {
            lobbyId: params.id!,
            unitId: mode.unitId,
            toX: coords.x,
            toY: coords.y,
          };
          moveUnit(payload);
          setMode({ kind: 'idle' });
        }
        return;
      }

      const unit = match.units.find(
        (candidate) =>
          candidate.x === coords.x &&
          candidate.y === coords.y &&
          candidate.owner === match.currentPlayerSid,
      );
      if (unit) {
        setMode({ kind: 'move', unitId: unit.id });
      } else {
        setMode({ kind: 'idle' });
      }
    };
  }, [lobby, match, mode, params?.id]);

  useEffect(() => {
    let disposed = false;
    const mount = async () => {
      if (!containerRef.current || phaserRef.current) return;
      const Phaser = (await import('phaser')) as PhaserType;
      let resolveScene: (scene: SceneApi) => void = () => undefined;
      const sceneReady = new Promise<SceneApi>((resolve) => {
        resolveScene = resolve;
      });

      const { Scene, AUTO, Game } = Phaser;

      class BoardScene extends Scene {
        private tileSize = 54;
        private unitTexts = new Map<string, PhaserType.GameObjects.Text>();
        private highlightGraphics!: PhaserType.GameObjects.Graphics;

        create() {
          const boardSize = this.tileSize * BOARD_W;
          const offsetX = (this.cameras.main.width - boardSize) / 2;
          const offsetY = (this.cameras.main.height - boardSize) / 2;
          this.highlightGraphics = this.add.graphics();
          for (let y = 0; y < BOARD_H; y += 1) {
            for (let x = 0; x < BOARD_W; x += 1) {
              const rect = this.add
                .rectangle(
                  offsetX + x * this.tileSize + this.tileSize / 2,
                  offsetY + y * this.tileSize + this.tileSize / 2,
                  this.tileSize - 2,
                  this.tileSize - 2,
                  (x + y) % 2 === 0 ? 0x0f172a : 0x172554,
                )
                .setStrokeStyle(1, 0x334155)
                .setInteractive({ useHandCursor: true });
              rect.on('pointerdown', () => {
                this.events.emit('tile:click', { x, y });
              });
            }
          }
          resolveScene(this as SceneApi);
        }

        private clearUnits() {
          for (const text of this.unitTexts.values()) {
            text.destroy();
          }
          this.unitTexts.clear();
        }

        renderMatch(match: MatchState | null) {
          this.clearUnits();
          if (!match) return;
          const boardSize = this.tileSize * BOARD_W;
          const offsetX = (this.cameras.main.width - boardSize) / 2;
          const offsetY = (this.cameras.main.height - boardSize) / 2;
          for (const unit of match.units) {
            const text = this.add
              .text(
                offsetX + unit.x * this.tileSize + this.tileSize / 2,
                offsetY + unit.y * this.tileSize + this.tileSize / 2,
                unit.type,
                {
                  color: '#f8fafc',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                },
              )
              .setOrigin(0.5, 0.5)
              .setDepth(2)
              .setInteractive({ useHandCursor: true });
            text.on('pointerdown', () => {
              this.events.emit('tile:click', { x: unit.x, y: unit.y });
            });
            this.unitTexts.set(unit.id, text);
          }
        }

        setHighlights(cells: Highlight[]) {
          this.highlightGraphics.clear();
          if (!cells.length) return;
          const boardSize = this.tileSize * BOARD_W;
          const offsetX = (this.cameras.main.width - boardSize) / 2;
          const offsetY = (this.cameras.main.height - boardSize) / 2;
          for (const cell of cells) {
            this.highlightGraphics.fillStyle(cell.color, 0.25);
            this.highlightGraphics.fillRect(
              offsetX + cell.x * this.tileSize,
              offsetY + cell.y * this.tileSize,
              this.tileSize,
              this.tileSize,
            );
            this.highlightGraphics.lineStyle(2, cell.color, 0.8);
            this.highlightGraphics.strokeRect(
              offsetX + cell.x * this.tileSize,
              offsetY + cell.y * this.tileSize,
              this.tileSize,
              this.tileSize,
            );
          }
        }
      }

      const game = new Game({
        type: AUTO,
        width: 520,
        height: 520,
        parent: containerRef.current,
        backgroundColor: '#0b1120',
        scene: [BoardScene],
      });
      phaserRef.current = game;
      const scene = await sceneReady;
      if (disposed) {
        game.destroy(true);
        return;
      }
      sceneRef.current = scene;
      scene.events.on('tile:click', (coords: TileCoords) => {
        tileHandlerRef.current(coords);
      });
      if (match) {
        scene.renderMatch(match);
      }
    };
    mount();
    return () => {
      disposed = true;
      if (sceneRef.current) {
        sceneRef.current.events.removeAllListeners();
      }
      if (phaserRef.current) {
        phaserRef.current.destroy(true);
        phaserRef.current = null;
      }
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.renderMatch(match);
    }
  }, [match]);

  const highlights = useMemo(() => {
    if (!match) return [] as Highlight[];
    if (mode.kind === 'spawn') {
      return computeSpawnCells(lobby, match, mode.unitType);
    }
    if (mode.kind === 'move') {
      const cells = computeMoveCells(match, mode.unitId);
      const unit = match.units.find((u) => u.id === mode.unitId);
      if (unit) {
        cells.push({ x: unit.x, y: unit.y, color: 0xf97316 });
      }
      return cells;
    }
    return [] as Highlight[];
  }, [lobby, match, mode]);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setHighlights(highlights);
    }
  }, [highlights]);

  if (!params?.id) {
    router.push('/');
    return null;
  }

  const handleSpawnClick = (unitType: keyof typeof UNIT_COST) => {
    setMode({ kind: 'spawn', unitType });
  };

  const handleEndTurn = () => {
    if (!params?.id) return;
    const payload: EndTurnPayload = { lobbyId: params.id };
    endTurn(payload);
    setMode({ kind: 'idle' });
  };

  const currentMana = match ? match.mana[match.currentPlayerSid] ?? 0 : 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Game #{params.id}</h1>
        {lobby && (
          <p className="text-sm text-muted-foreground">
            Turn {match?.turnNumber ?? lobby.turnNumber} • Current player{' '}
            {match?.currentPlayerSid ? match.currentPlayerSid.slice(0, 8) : 'TBD'}
          </p>
        )}
        {match?.winnerSid && (
          <p className="text-sm font-semibold text-emerald-400">
            Winner: {match.winnerSid.slice(0, 8)}
          </p>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div
          ref={containerRef}
          className="flex h-[520px] items-center justify-center overflow-hidden rounded-xl border border-border bg-slate-900"
        >
          {!match && <span className="text-muted-foreground">Waiting for match...</span>}
        </div>
        <aside className="space-y-4 rounded-xl border border-border p-4">
          <div>
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Mana</h2>
            <p className="mt-1 text-lg font-bold text-sky-300">{currentMana}</p>
            <p className="text-xs text-muted-foreground">
              Active player mana per turn: {MANA_PER_TURN}
            </p>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Summon</h2>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(UNIT_COST) as Array<keyof typeof UNIT_COST>).map((unitType) => (
                <Button
                  key={unitType}
                  variant={mode.kind === 'spawn' && mode.unitType === unitType ? 'default' : 'outline'}
                  onClick={() => handleSpawnClick(unitType)}
                  disabled={!match || Boolean(match?.winnerSid)}
                >
                  {unitType} ({UNIT_COST[unitType]})
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Actions</h2>
            <Button onClick={handleEndTurn} disabled={!match || Boolean(match.winnerSid)}>
              End Turn
            </Button>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Players</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {lobby?.players.map((player) => (
                <li key={player.sid} className="flex items-center justify-between">
                  <span>{player.sid.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">
                    Mana: {match?.mana[player.sid] ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
