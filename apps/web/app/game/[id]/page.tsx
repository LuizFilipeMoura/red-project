'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ErrorPayload, Lobby } from '@repo/shared';
import { joinLobby, passTurn, socketClient } from '../../../lib/socket';
import { Button } from '../../../components/ui/button';

export default function GamePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const phaserRef = useRef<any>(null);
  const [lobby, setLobby] = useState<Lobby | null>(null);

  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    joinLobby(id);
    const unsubSync = socketClient.on('state:sync', (payload: { lobby: Lobby }) => {
      if (payload.lobby.id === id) {
        setLobby(payload.lobby);
      }
    });
    const unsubError = socketClient.on<ErrorPayload>('error', (payload) => toast.error(payload.message));
    return () => {
      unsubSync?.();
      unsubError?.();
    };
  }, [params?.id]);

  useEffect(() => {
    const mount = async () => {
      if (!containerRef.current || phaserRef.current) return;
      const Phaser = await import('phaser');
      class BoardScene extends Phaser.Scene {
        private gridSize = 6;
        constructor() {
          super('Board');
        }
        create() {
          const g = this.add.graphics({ lineStyle: { width: 1, color: 0x94a3b8 } });
          const size = 360;
          const offsetX = (this.cameras.main.width - size) / 2;
          const offsetY = (this.cameras.main.height - size) / 2;
          for (let i = 0; i <= this.gridSize; i++) {
            const pos = offsetX + (i * size) / this.gridSize;
            g.lineBetween(pos, offsetY, pos, offsetY + size);
            g.lineBetween(offsetX, offsetY + (i * size) / this.gridSize, offsetX + size, offsetY + (i * size) / this.gridSize);
          }
          this.add.text(offsetX, offsetY + size + 16, 'Demo grid', { color: '#cbd5f5' });
        }
      }
      phaserRef.current = new Phaser.Game({
        type: Phaser.AUTO,
        width: 480,
        height: 480,
        parent: containerRef.current,
        backgroundColor: '#0f172a',
        scene: [BoardScene],
      });
    };
    mount();
    return () => {
      if (phaserRef.current) {
        phaserRef.current.destroy(true);
        phaserRef.current = null;
      }
    };
  }, []);

  if (!params?.id) {
    router.push('/');
    return null;
  }

  const handlePassTurn = () => {
    if (!lobby) return;
    passTurn(lobby.id);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Game #{params.id}</h1>
        {lobby && (
          <p className="text-sm text-muted-foreground">
            Turn {lobby.turnNumber} • Current player {lobby.currentPlayerSid?.slice(0, 8) ?? 'TBD'}
          </p>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div
          ref={containerRef}
          className="flex h-[480px] items-center justify-center overflow-hidden rounded-xl border border-border"
        >
          {!lobby && <span className="text-muted-foreground">Connecting to game...</span>}
        </div>
        <aside className="space-y-4 rounded-xl border border-border p-4">
          <div>
            <h2 className="text-sm font-semibold uppercase text-muted-foreground">Players</h2>
            <ul className="mt-2 space-y-1">
              {lobby?.players.map((player) => (
                <li key={player.sid} className="flex items-center justify-between text-sm">
                  <span>{player.sid.slice(0, 8)}</span>
                  {lobby.currentPlayerSid === player.sid && (
                    <span className="text-xs text-primary">Your turn</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <Button onClick={handlePassTurn} disabled={!lobby || lobby.players.length < 2}>
            Pass turn
          </Button>
          {lobby?.deadlineAt && (
            <p className="text-xs text-muted-foreground">
              Auto pass at {new Date(lobby.deadlineAt).toLocaleTimeString()}
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}
