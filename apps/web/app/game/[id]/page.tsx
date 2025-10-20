'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type {
  Card_Spell,
  Card_Talent,
  Card_Unit,
  EndTurnPayload,
  ErrorPayload,
  Lobby,
  MatchState,
  MoveUnitPayload,
  PlaySpellCardPayload,
  PlayTalentCardPayload,
  PlayUnitCardPayload,
} from '@repo/shared';
import {
  BOARD_H,
  BOARD_W,
  EVENTS,
  FLAG_A,
  FLAG_B,
  FLAG_TURNS_TO_WIN,
  MANA_PER_TURN,
  MOVE_RANGE,
} from '@repo/shared';
import {
  endTurn,
  joinLobby,
  moveUnit,
  playSpellCard,
  playTalentCard,
  playUnitCard,
  socketClient,
} from '../../../lib/socket';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import type * as PhaserType from 'phaser';
import {
  computeSpawnRowsForSide,
  computeTalentRangeCells,
  resolveSpellArea,
  type BoardCell,
} from '../../../lib/game/helpers';

type Mode =
  | { kind: 'idle' }
  | { kind: 'move'; unitId: string }
  | { kind: 'unitCard'; cardId: string; card: Card_Unit }
  | { kind: 'spellCard'; cardId: string; card: Card_Spell }
  | { kind: 'talentCard'; cardId: string; card: Card_Talent };

type Highlight = { x: number; y: number; color: number };

type TileCoords = { x: number; y: number };

type SceneApi = PhaserType.Scene & {
  renderMatch: (match: MatchState | null, currentUserSid?: string | null) => void;
  setHighlights: (cells: Highlight[]) => void;
};

const DEFAULT_BOARD: MatchState['board'] = {
  width: BOARD_W,
  height: BOARD_H,
  flagA: FLAG_A,
  flagB: FLAG_B,
};

const getPlayerSide = (lobby: Lobby | null, sid: string): 'A' | 'B' | null => {
  if (!lobby) return null;
  if (lobby.players.length < 2) return null;
  const sorted = [...lobby.players].sort(
    (a, b) => new Date(a.joinedAt).valueOf() - new Date(b.joinedAt).valueOf(),
  );
  if (sorted[0]?.sid === sid) return 'A';
  if (sorted[1]?.sid === sid) return 'B';
  return null;
};

const describeCard = (card: Card_Unit | Card_Spell | Card_Talent) => {
  if (card.kind === 'Unit') {
    return `${card.unitType} • Cost ${card.cost} • HP ${card.hpBase}`;
  }
  if (card.kind === 'Spell') {
    return `${card.name} • Cost ${card.cost}`;
  }
  return `${card.unitType} Talent • Cost ${card.cost}`;
};

const computeSpawnCells = (match: MatchState, lobby: Lobby | null, sid: string) => {
  const side = getPlayerSide(lobby, sid);
  if (!side) return [] as Highlight[];
  const potential = computeSpawnRowsForSide(side);
  return potential
    .filter((cell) => !match.units.some((unit) => unit.x === cell.x && unit.y === cell.y))
    .map((cell) => ({ ...cell, color: 0x22c55e }));
};

const computeMoveCells = (match: MatchState, unitId: string) => {
  const unit = match.units.find((u) => u.id === unitId);
  if (!unit) return [] as Highlight[];
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
  cells.push({ x: unit.x, y: unit.y, color: 0xf97316 });
  return cells;
};

const computeSpellHighlights = (
  match: MatchState,
  card: Card_Spell,
  anchor: BoardCell | null,
): Highlight[] => {
  if (!anchor) return [];
  const cells = resolveSpellArea(card.area, anchor);
  return cells.map((cell) => ({ ...cell, color: 0xef4444 }));
};

const computeTalentHighlights = (
  match: MatchState,
  card: Card_Talent,
): Highlight[] => {
  const sourceUnit = match.units.find((unit) => unit.id === card.sourceUnitId);
  if (!sourceUnit) return [];
  const rangeCells = computeTalentRangeCells(card, { x: sourceUnit.x, y: sourceUnit.y });
  const highlights = rangeCells.map((cell) => ({ ...cell, color: 0xa855f7 }));
  highlights.push({ x: sourceUnit.x, y: sourceUnit.y, color: 0xf97316 });
  return highlights;
};

const formatTalentText = (card: Card_Talent) => {
  if (card.effect.type === 'damage') {
    return `${card.text} (Damage ${card.effect.amount})`;
  }
  return `${card.text} (Heal ${card.effect.amount})`;
};

export default function GamePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const phaserRef = useRef<PhaserType.Game | null>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const tileHandlerRef = useRef<(coords: TileCoords) => void>(() => undefined);
  const hoverHandlerRef = useRef<(coords: TileCoords | null) => void>(() => undefined);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [match, setMatch] = useState<MatchState | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [currentUserSid, setCurrentUserSid] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<TileCoords | null>(null);
  const [isDeckOpen, setIsDeckOpen] = useState(false);

  const isMyTurn = match && currentUserSid && match.currentPlayerSid === currentUserSid;
  const isGameActive = match && !match.winnerSid;

  const playerOrder = useMemo(() => {
    if (!lobby || lobby.players.length < 2) return [] as Array<{ sid: string; label: string }>;
    const sorted = [...lobby.players].sort(
      (a, b) => new Date(a.joinedAt).valueOf() - new Date(b.joinedAt).valueOf(),
    );
    return sorted.map((player, index) => ({
      sid: player.sid,
      label: index === 0 ? 'Player A' : 'Player B',
    }));
  }, [lobby]);

  const flagHoldSummaries = useMemo(
    () =>
      playerOrder.map((player) => ({
        ...player,
        turns: match?.flagControlTurns?.[player.sid] ?? 0,
      })),
    [playerOrder, match],
  );

  useEffect(() => {
    const lobbyId = params?.id;
    if (!lobbyId) return;
    joinLobby(lobbyId);
    const unsubSync = socketClient.on<{ lobby: Lobby; match: MatchState | null; yourSid?: string }>(
      EVENTS.STATE_SYNC,
      (payload) => {
        if (payload.lobby.id !== lobbyId) return;
        setLobby(payload.lobby);
        setMatch(payload.match);
        if (payload.yourSid) {
          setCurrentUserSid(payload.yourSid);
        }
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
      if (!isMyTurn || !isGameActive) return;
      if (!currentUserSid) return;

      if (mode.kind === 'unitCard') {
        const highlights = computeSpawnCells(match, lobby, currentUserSid);
        const isValid = highlights.some((cell) => cell.x === coords.x && cell.y === coords.y);
        if (isValid) {
          const payload: PlayUnitCardPayload = {
            lobbyId: params.id,
            cardId: mode.cardId,
            x: coords.x,
            y: coords.y,
          };
          playUnitCard(payload);
          setMode({ kind: 'idle' });
        }
        return;
      }

      if (mode.kind === 'spellCard') {
        const payload: PlaySpellCardPayload = {
          lobbyId: params.id,
          cardId: mode.cardId,
          anchorX: coords.x,
          anchorY: coords.y,
        };
        playSpellCard(payload);
        setMode({ kind: 'idle' });
        return;
      }

      if (mode.kind === 'talentCard') {
        const payload: PlayTalentCardPayload = {
          lobbyId: params.id,
          cardId: mode.cardId,
          targetX: coords.x,
          targetY: coords.y,
        };
        playTalentCard(payload);
        setMode({ kind: 'idle' });
        return;
      }

      if (mode.kind === 'move') {
        const movable = computeMoveCells(match, mode.unitId).some(
          (cell) => cell.x === coords.x && cell.y === coords.y,
        );
        if (movable) {
          const payload: MoveUnitPayload = {
            lobbyId: params.id,
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
  }, [match, mode, params?.id, lobby, isMyTurn, isGameActive, currentUserSid]);

  useEffect(() => {
    hoverHandlerRef.current = (coords: TileCoords | null) => {
      setHoverCell(coords);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const mount = async () => {
      if (!containerRef.current || phaserRef.current) return;
      const Phaser = (await import('phaser')) as typeof import('phaser');
      const { Scene, AUTO, Game } = Phaser;

      let resolveScene: (scene: SceneApi) => void = () => undefined;
      const sceneReady = new Promise<SceneApi>((resolve) => {
        resolveScene = resolve;
      });

      class BoardScene extends Scene {
        private tileSize = 54;
        private boardOffsetX = 0;
        private boardOffsetY = 0;
        private unitTexts = new Map<string, PhaserType.GameObjects.Text>();
        private highlightGraphics!: PhaserType.GameObjects.Graphics;
        private flagMarkers: Array<{
          circle: PhaserType.GameObjects.Arc;
          label: PhaserType.GameObjects.Text;
        }> = [];

        private tileCenter(x: number, y: number) {
          return {
            x: this.boardOffsetX + x * this.tileSize + this.tileSize / 2,
            y: this.boardOffsetY + y * this.tileSize + this.tileSize / 2,
          };
        }

        private updateFlagMarkers(board: MatchState['board']) {
          const configs = [
            { coords: board.flagA, color: 0xfacc15, label: 'A' },
            { coords: board.flagB, color: 0xf43f5e, label: 'B' },
          ] as const;
          configs.forEach((config, index) => {
            const center = this.tileCenter(config.coords.x, config.coords.y);
            const marker = this.flagMarkers[index];
            if (!marker) {
              const circle = this.add
                .circle(center.x, center.y, this.tileSize * 0.32, config.color, 0.85)
                .setStrokeStyle(2, 0xf8fafc, 0.9)
                .setDepth(1);
              const label = this.add
                .text(center.x, center.y, config.label, {
                  color: '#020617',
                  fontSize: '16px',
                  fontFamily: 'monospace',
                  fontStyle: 'bold',
                })
                .setOrigin(0.5, 0.6)
                .setDepth(2);
              this.flagMarkers[index] = { circle, label };
            } else {
              marker.circle.setPosition(center.x, center.y);
              marker.circle.setFillStyle(config.color, 0.85);
              marker.label.setPosition(center.x, center.y);
              marker.label.setText(config.label);
            }
          });
        }

        create() {
          const boardSize = this.tileSize * BOARD_W;
          this.boardOffsetX = (this.cameras.main.width - boardSize) / 2;
          this.boardOffsetY = (this.cameras.main.height - boardSize) / 2;
          this.highlightGraphics = this.add.graphics();
          for (let y = 0; y < BOARD_H; y += 1) {
            for (let x = 0; x < BOARD_W; x += 1) {
              const rect = this.add
                .rectangle(
                  this.boardOffsetX + x * this.tileSize + this.tileSize / 2,
                  this.boardOffsetY + y * this.tileSize + this.tileSize / 2,
                  this.tileSize - 2,
                  this.tileSize - 2,
                  (x + y) % 2 === 0 ? 0x0f172a : 0x172554,
                )
                .setStrokeStyle(1, 0x334155)
                .setInteractive({ useHandCursor: true });
              rect.on('pointerdown', () => {
                this.events.emit('tile:click', { x, y });
              });
              rect.on('pointerover', () => {
                this.events.emit('tile:hover', { x, y });
              });
              rect.on('pointerout', () => {
                this.events.emit('tile:hover', null);
              });
            }
          }
          this.updateFlagMarkers(DEFAULT_BOARD);
          resolveScene(this as SceneApi);
        }

        private clearUnits() {
          for (const text of this.unitTexts.values()) {
            text.destroy();
          }
          this.unitTexts.clear();
        }

        renderMatch(matchState: MatchState | null, currentUserSid: string | null = null) {
          this.clearUnits();
          if (!matchState) {
            this.updateFlagMarkers(DEFAULT_BOARD);
            return;
          }
          this.updateFlagMarkers(matchState.board);
          for (const unit of matchState.units) {
            const center = this.tileCenter(unit.x, unit.y);
            const textColor =
              currentUserSid !== null
                ? unit.owner === currentUserSid
                  ? '#38bdf8'
                  : '#f87171'
                : unit.owner === matchState.currentPlayerSid
                  ? '#f8fafc'
                  : '#cbd5f5';
            const text = this.add
              .text(
                center.x,
                center.y,
                `${unit.type}\n${unit.hp}/${unit.hpMax}`,
                {
                  color: textColor,
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  align: 'center',
                },
              )
              .setOrigin(0.5, 0.6)
              .setDepth(2)
              .setInteractive({ useHandCursor: true });
            text.on('pointerdown', () => {
              this.events.emit('tile:click', { x: unit.x, y: unit.y });
            });
            text.on('pointerover', () => {
              this.events.emit('tile:hover', { x: unit.x, y: unit.y });
            });
            text.on('pointerout', () => {
              this.events.emit('tile:hover', null);
            });
            this.unitTexts.set(unit.id, text);
          }
        }

        setHighlights(cells: Highlight[]) {
          this.highlightGraphics.clear();
          if (!cells.length) return;
          for (const cell of cells) {
            this.highlightGraphics.fillStyle(cell.color, 0.25);
            this.highlightGraphics.fillRect(
              this.boardOffsetX + cell.x * this.tileSize,
              this.boardOffsetY + cell.y * this.tileSize,
              this.tileSize,
              this.tileSize,
            );
            this.highlightGraphics.lineStyle(2, cell.color, 0.8);
            this.highlightGraphics.strokeRect(
              this.boardOffsetX + cell.x * this.tileSize,
              this.boardOffsetY + cell.y * this.tileSize,
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
      scene.events.on('tile:hover', (coords: TileCoords | null) => {
        hoverHandlerRef.current(coords);
      });
      if (match) {
        scene.renderMatch(match, currentUserSid);
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
      sceneRef.current.renderMatch(match, currentUserSid);
    }
  }, [match, currentUserSid]);

  const yourHandCards = useMemo(() => {
    if (!match || !currentUserSid) return [] as Array<{ cardId: string; card: Card_Unit | Card_Spell }>;
    const deckState = match.decks[currentUserSid];
    if (!deckState) return [];
    return deckState.hand
      .map((cardId) => ({ cardId, card: match.cards[cardId] }))
      .filter(
        (entry): entry is { cardId: string; card: Card_Unit | Card_Spell } =>
          Boolean(entry.card) && entry.card.kind !== 'Talent',
      );
  }, [match, currentUserSid]);

  const yourTalents = useMemo(() => {
    if (!match || !currentUserSid) return [] as Array<{ cardId: string; card: Card_Talent }>;
    const talentIds = match.talentsInHand[currentUserSid] ?? [];
    return talentIds
      .map((cardId) => ({ cardId, card: match.cards[cardId] }))
      .filter(
        (entry): entry is { cardId: string; card: Card_Talent } =>
          Boolean(entry.card) && entry.card.kind === 'Talent',
      );
  }, [match, currentUserSid]);

  const highlights = useMemo(() => {
    if (!match || !currentUserSid) return [] as Highlight[];
    if (mode.kind === 'unitCard') {
      return computeSpawnCells(match, lobby, currentUserSid);
    }
    if (mode.kind === 'move') {
      return computeMoveCells(match, mode.unitId);
    }
    if (mode.kind === 'spellCard') {
      return computeSpellHighlights(match, mode.card, hoverCell);
    }
    if (mode.kind === 'talentCard') {
      return computeTalentHighlights(match, mode.card);
    }
    return [] as Highlight[];
  }, [match, lobby, currentUserSid, mode, hoverCell]);

  useEffect(() => {
    if (sceneRef.current) {
      sceneRef.current.setHighlights(highlights);
    }
  }, [highlights]);

  if (!params?.id) {
    router.push('/');
    return null;
  }

  const handleEndTurn = () => {
    if (!params?.id) return;
    const payload: EndTurnPayload = { lobbyId: params.id };
    endTurn(payload);
    setMode({ kind: 'idle' });
  };

  const currentMana = match && currentUserSid ? match.mana[currentUserSid] ?? 0 : 0;
  const deckState = match && currentUserSid ? match.decks[currentUserSid] : null;

  const deckSections = deckState
    ? [
        { label: 'Deck', items: deckState.deck },
        { label: 'Hand', items: deckState.hand },
        { label: 'Discard', items: deckState.discard },
        { label: 'Graveyard', items: deckState.graveyard },
      ]
    : [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Game #{params.id}</h1>
        {lobby && (
          <p className="text-sm text-muted-foreground">
            Turn {match?.turnNumber ?? lobby.turnNumber} • Current player{' '}
            {match?.currentPlayerSid ? match.currentPlayerSid.slice(0, 8) : 'TBD'}
            {isMyTurn && <span className="ml-2 text-emerald-400 font-semibold">(Your turn!)</span>}
          </p>
        )}
        {flagHoldSummaries.length === 2 && (
          <div className="text-xs">
            <p className="font-semibold uppercase tracking-wide text-muted-foreground">
              Flag Hold Progress
            </p>
            <div className="mt-1 flex flex-wrap gap-3 text-sm text-muted-foreground">
              {flagHoldSummaries.map((entry) => (
                <span
                  key={entry.sid}
                  className="flex items-center gap-2 rounded-lg bg-slate-900/60 px-3 py-1"
                >
                  <span className="font-semibold text-foreground">{entry.label}</span>
                  <span>
                    {entry.turns}/{FLAG_TURNS_TO_WIN} turns
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">({entry.sid.slice(0, 6)})</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {match?.winnerSid && (
          <p className="text-sm font-semibold text-emerald-400">
            Winner: {match.winnerSid.slice(0, 8)}
          </p>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_1.1fr]">
        <div
          ref={containerRef}
          className="flex h-[520px] items-center justify-center overflow-hidden rounded-xl border border-border bg-slate-900"
        >
          {!match && <span className="text-muted-foreground">Waiting for match...</span>}
        </div>
        <aside className="space-y-4 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">Mana</h2>
              <p className="mt-1 text-lg font-bold text-sky-300">{currentMana}</p>
              <p className="text-xs text-muted-foreground">Per turn: {MANA_PER_TURN}</p>
            </div>
            <Button onClick={handleEndTurn} disabled={!isGameActive || !isMyTurn}>
              End Turn
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase text-muted-foreground">Deck Viewer</h2>
              <Button variant="outline" size="sm" onClick={() => setIsDeckOpen((prev) => !prev)}>
                {isDeckOpen ? 'Hide' : 'Show'}
              </Button>
            </div>
            {isDeckOpen && (
              <Card className="bg-slate-950/40">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Your Cards</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  {deckSections.map((section) => (
                    <div key={section.label}>
                      <p className="text-xs font-semibold uppercase text-muted-foreground">{section.label}</p>
                      {section.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Empty</p>
                      ) : (
                        <ul className="mt-1 space-y-1">
                          {section.items.map((cardId) => {
                            const card = match?.cards[cardId];
                            if (!card || card.kind === 'Talent') return null;
                            return (
                              <li key={cardId} className="flex items-center justify-between gap-2">
                                <span className="truncate">{describeCard(card)}</span>
                                <span className="text-[10px] text-muted-foreground">{cardId.slice(0, 6)}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Hand</h2>
            <div className="flex flex-col gap-2">
              {yourHandCards.length === 0 && (
                <p className="text-xs text-muted-foreground">No cards in hand.</p>
              )}
              {yourHandCards.map(({ cardId, card }) => {
                const isSelected =
                  (mode.kind === 'unitCard' || mode.kind === 'spellCard') && mode.cardId === cardId;
                const disabled = !isMyTurn || !isGameActive;
                return (
                  <button
                    key={cardId}
                    type="button"
                    className={`flex flex-col rounded-lg border p-2 text-left transition ${
                      isSelected ? 'border-sky-400 bg-sky-500/10' : 'border-border bg-slate-950/40'
                    } ${disabled ? 'opacity-50' : 'hover:border-sky-400 hover:bg-sky-500/10'}`}
                    onClick={() => {
                      if (disabled) return;
                      if (card.kind === 'Unit') {
                        setMode((prev) =>
                          prev.kind === 'unitCard' && prev.cardId === cardId
                            ? { kind: 'idle' }
                            : { kind: 'unitCard', cardId, card },
                        );
                      } else {
                        setMode((prev) =>
                          prev.kind === 'spellCard' && prev.cardId === cardId
                            ? { kind: 'idle' }
                            : { kind: 'spellCard', cardId, card },
                        );
                      }
                    }}
                  >
                    <span className="text-sm font-semibold text-sky-200">
                      {card.kind === 'Unit' ? card.unitType : card.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{describeCard(card)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Talents</h2>
            <div className="flex flex-col gap-2">
              {yourTalents.length === 0 && (
                <p className="text-xs text-muted-foreground">No talents available.</p>
              )}
              {yourTalents.map(({ cardId, card }) => {
                const isSelected = mode.kind === 'talentCard' && mode.cardId === cardId;
                const disabled = !isMyTurn || !isGameActive;
                return (
                  <button
                    key={cardId}
                    type="button"
                    className={`flex flex-col rounded-lg border p-2 text-left transition ${
                      isSelected ? 'border-purple-400 bg-purple-500/10' : 'border-border bg-slate-950/40'
                    } ${disabled ? 'opacity-50' : 'hover:border-purple-400 hover:bg-purple-500/10'}`}
                    onClick={() => {
                      if (disabled) return;
                      setMode((prev) =>
                        prev.kind === 'talentCard' && prev.cardId === cardId
                          ? { kind: 'idle' }
                          : { kind: 'talentCard', cardId, card },
                      );
                    }}
                  >
                    <span className="text-sm font-semibold text-purple-200">{card.unitType} Talent</span>
                    <span className="text-xs text-muted-foreground">{formatTalentText(card)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Players</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {lobby?.players.map((player) => (
                <li key={player.sid} className="flex items-center justify-between">
                  <span>
                    {player.sid.slice(0, 8)}
                    {player.sid === currentUserSid && <span className="ml-1 text-xs text-sky-400">(You)</span>}
                  </span>
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
