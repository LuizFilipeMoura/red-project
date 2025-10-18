'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ErrorPayload, LobbyListPayload, StateSync } from '@repo/shared';
import {
  createLobby,
  joinLobby,
  requestLobbyList,
  socketClient,
} from '../lib/socket';
import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Input } from '../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

export default function HomePage() {
  const [lobbies, setLobbies] = useState<LobbyListPayload>({ items: [], page: 1, total: 0 });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  useEffect(() => {
    const unsubList = socketClient.on<LobbyListPayload>('lobby:list', (payload) => {
      console.log('Received lobby list:', payload);
      setLobbies(payload);
    });
    const unsubSync = socketClient.on<StateSync & { yourSid?: string }>('state:sync', (payload) => {
      const lobbyId = payload.lobby.id;
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        if (!path.startsWith(`/lobby/${lobbyId}`) && !path.startsWith(`/game/${lobbyId}`)) {
          router.push(`/lobby/${lobbyId}`);
        }
      }
      requestLobbyList();
    });
    const unsubError = socketClient.on<ErrorPayload>('error', (payload) => {
      toast.error(payload.message);
    });
    requestLobbyList();
    return () => {
      unsubList?.();
      unsubSync?.();
      unsubError?.();
    };
  }, [router]);

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Lobby name required');
      return;
    }
    createLobby({ name, password: password || undefined });
    setName('');
    setPassword('');
  };

  const handleJoin = (lobbyId: string) => {
    joinLobby(lobbyId);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-6 py-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold">Active Lobbies</h1>
        <p className="text-muted-foreground">
          Create a lobby or join an existing game to start a two-player turn-based session.
        </p>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Public rooms</CardTitle>
            <CardDescription>
              Showing {lobbies.items?.length} of {lobbies.total} open slots.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Players</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lobbies.items?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No public lobbies yet. Create one!
                    </TableCell>
                  </TableRow>
                )}
                {lobbies.items.map((lobby) => (
                  <TableRow key={lobby.id}>
                    <TableCell>{lobby.name}</TableCell>
                    <TableCell className="capitalize">{lobby.status}</TableCell>
                    <TableCell>
                      {lobby.players.length}/{lobby.capacity}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button onClick={() => handleJoin(lobby.id)} disabled={lobby.players.length >= lobby.capacity}>
                        Join
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
          <CardFooter className="justify-between text-sm text-muted-foreground">
            <span>Auto-refreshes via sockets</span>
            <Button variant="ghost" onClick={() => requestLobbyList(lobbies.page)}>
              Refresh
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Create lobby</CardTitle>
            <CardDescription>Optional password turns your room private.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={handleCreate}>
              <div className="space-y-1">
                <label className="text-sm font-medium">Lobby name</label>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="My lobby" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Password (optional)</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••"
                />
              </div>
              <Button type="submit">Create</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
