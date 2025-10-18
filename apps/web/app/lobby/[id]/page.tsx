'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ErrorPayload, Lobby } from '@repo/shared';
import {
  joinLobby,
  leaveLobby,
  passTurn,
  socketClient,
  startLobby,
} from '../../../lib/socket';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';

export default function LobbyPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [lobby, setLobby] = useState<Lobby | null>(null);

  useEffect(() => {
    const id = params?.id;
    if (!id) return;

    console.log('Setting up state:sync listener');
    joinLobby(id);

    const unsub = socketClient.on('state:sync', (payload: { lobby: Lobby }) => {
      console.log("State sync received:", payload);
      if (payload.lobby.id === id) {
        setLobby(payload.lobby);
      }
    });
    const unsubErr = socketClient.on<ErrorPayload>('error', (payload) => toast.error(payload.message));
    return () => {
      unsub?.();
      unsubErr?.();
    };
  }, [params?.id]);

  console.log("Lobby state:", lobby);

  // Refetch logic when lobby is not loaded - retry joinLobby to trigger server response
  useEffect(() => {
    const id = params?.id;
    if (!id || lobby) return;

    const timeouts: NodeJS.Timeout[] = [];

    // Retry joinLobby at intervals - this will trigger the server to send state:sync
    timeouts.push(setTimeout(() => {
      console.log('Retrying joinLobby after 100ms');
      joinLobby(id);
    }, 100));

    timeouts.push(setTimeout(() => {
      console.log('Retrying joinLobby after 1000ms');
      joinLobby(id);
    }, 1000));

    timeouts.push(setTimeout(() => {
      console.log('Retrying joinLobby after 5000ms');
      joinLobby(id);
    }, 5000));

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [params?.id, lobby]);

  const handleBackToList = () => {
    router.push('/');
  };

  if (!lobby) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Loading lobby...</p>
        <Button variant="outline" onClick={handleBackToList}>
          Back to lobby list
        </Button>
      </main>
    );
  }

  const handleLeave = () => {
    leaveLobby(lobby.id);
    router.push('/');
  };

  const handleStart = () => {
    startLobby(lobby.id);
  };

  const handlePassTurn = () => {
    if (!lobby) return;
    passTurn(lobby.id);
  };

  const isFull = lobby.players.length >= lobby.capacity;
  const gameStarted = lobby.status === 'started';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={handleBackToList}>
          ← Back to lobby list
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{lobby.name}</span>
            <span className="text-sm font-normal capitalize text-muted-foreground">{lobby.status}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h2 className="text-sm font-medium uppercase text-muted-foreground">Players</h2>
            <ul className="mt-2 space-y-2">
              {lobby.players.map((player) => (
                <li
                  key={player.sid}
                  className="flex items-center justify-between rounded border border-dashed border-border px-3 py-2"
                >
                  <span className="font-medium">{player.sid.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">
                    Joined {new Date(player.joinedAt).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
            {!isFull && <p className="mt-2 text-sm text-muted-foreground">Waiting for players...</p>}
          </div>
          {lobby.currentPlayerSid && (
            <div className="rounded-md bg-muted p-3 text-sm">
              Current turn: <strong>{lobby.currentPlayerSid.slice(0, 8)}</strong>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex items-center justify-between">
          <Button variant="ghost" onClick={handleLeave}>
            Leave lobby
          </Button>
          <div className="flex gap-2">
            {gameStarted && (
              <Button variant="secondary" onClick={handlePassTurn} disabled={!lobby.currentPlayerSid}>
                Pass turn
              </Button>
            )}
            <Button onClick={handleStart} disabled={!isFull || gameStarted}>
              Start match
            </Button>
          </div>
        </CardFooter>
      </Card>
    </main>
  );
}
