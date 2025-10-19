'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  joinGaMonitor,
  onGaReplayEnd,
  onGaReplayFrame,
  onGaReplayStart,
  onGaUpdate,
  requestGaReplay,
} from '../../../lib/socket';
import type { GaReplayFramePayload, GaReplayStartPayload, GaSnapshot } from '@repo/shared';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

type Snapshot = GaSnapshot;

type ReplayState = {
  start: GaReplayStartPayload;
  lastFrame?: GaReplayFramePayload;
  active: boolean;
  endReason?: string;
};

const MAX_SNAPSHOTS = 120;

const MonitorPage = () => {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [replay, setReplay] = useState<ReplayState | undefined>(undefined);
  const [isPaused, setIsPaused] = useState(false);
  const pauseRef = useRef(false);

  useEffect(() => {
    pauseRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_GA_MONITOR_TOKEN ?? 'dev-monitor-token';
    joinGaMonitor(token);

    const unsubscribeUpdate = onGaUpdate((snapshot) => {
      setSnapshots((prev) => {
        const map = new Map(prev.map((item) => [item.gen, item]));
        map.set(snapshot.gen, snapshot);
        return Array.from(map.values())
          .sort((a, b) => b.gen - a.gen)
          .slice(0, MAX_SNAPSHOTS);
      });
    });

    const unsubscribeStart = onGaReplayStart((payload) => {
      setReplay({ start: payload, active: true });
    });

    const unsubscribeFrame = onGaReplayFrame((payload) => {
      if (pauseRef.current) {
        return;
      }
      setReplay((prev) => {
        if (!prev) return prev;
        return { ...prev, lastFrame: payload };
      });
    });

    const unsubscribeEnd = onGaReplayEnd((payload) => {
      setReplay((prev) => {
        if (!prev || prev.start.gen !== payload.gen) return prev;
        return { ...prev, active: false, endReason: payload.reason };
      });
    });

    return () => {
      unsubscribeUpdate();
      unsubscribeStart();
      unsubscribeFrame();
      unsubscribeEnd();
    };
  }, []);

  const chartData = useMemo(
    () =>
      [...snapshots]
        .sort((a, b) => a.gen - b.gen)
        .map((snapshot) => ({
          gen: snapshot.gen,
          best: snapshot.best.fitness,
          mean: snapshot.mean,
        })),
    [snapshots],
  );

  const latestSnapshot = snapshots[0];

  const requestReplay = (gen: number, speed = 1) => {
    setIsPaused(false);
    pauseRef.current = false;
    requestGaReplay(gen, speed);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">GA Monitor</h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe métricas em tempo real do algoritmo genético e solicite replays das gerações.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4">
          <h2 className="font-medium text-sm text-muted-foreground">Geração atual</h2>
          <p className="text-2xl font-semibold">{latestSnapshot?.gen ?? '–'}</p>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="font-medium text-sm text-muted-foreground">Melhor fitness</h2>
          <p className="text-2xl font-semibold">
            {latestSnapshot ? latestSnapshot.best.fitness.toFixed(2) : '–'}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="font-medium text-sm text-muted-foreground">Média</h2>
          <p className="text-2xl font-semibold">
            {latestSnapshot ? latestSnapshot.mean.toFixed(2) : '–'}
          </p>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-4 text-lg font-semibold">Evolução das métricas</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="gen" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="best" stroke="#6366f1" name="Best" dot={false} />
              <Line type="monotone" dataKey="mean" stroke="#14b8a6" name="Mean" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-lg border">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Histórico de gerações</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide">Geração</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide">Fitness</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide">P90</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide">Variância</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide">Win Rate</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide">Replay</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {snapshots.map((snapshot) => (
                <tr key={snapshot.gen}>
                  <td className="px-4 py-2 text-sm font-medium">{snapshot.gen}</td>
                  <td className="px-4 py-2 text-sm">{snapshot.best.fitness.toFixed(2)}</td>
                  <td className="px-4 py-2 text-sm">{snapshot.p90.toFixed(2)}</td>
                  <td className="px-4 py-2 text-sm">{snapshot.variance.toFixed(2)}</td>
                  <td className="px-4 py-2 text-sm">
                    {snapshot.best.winRate !== undefined
                      ? `${(snapshot.best.winRate * 100).toFixed(1)}%`
                      : '–'}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    <div className="flex gap-2">
                      <button
                        className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                        onClick={() => requestReplay(snapshot.gen, 1)}
                      >
                        Reproduzir
                      </button>
                      <button
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => requestReplay(snapshot.gen, 0.5)}
                      >
                        0.5×
                      </button>
                      <button
                        className="rounded border px-2 py-1 text-xs"
                        onClick={() => requestReplay(snapshot.gen, 2)}
                      >
                        2×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Replay</h2>
          {replay && (
            <div className="flex items-center gap-2 text-sm">
              <span>
                Geração {replay.start.gen} · Seed {replay.start.seed}
              </span>
              <button
                className="rounded border px-3 py-1 text-xs"
                onClick={() => setIsPaused((prev) => !prev)}
              >
                {isPaused ? 'Retomar' : 'Pausar'}
              </button>
            </div>
          )}
        </div>

        {replay ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>
                Status: {replay.active ? 'Transmitindo' : replay.endReason ?? 'Inativo'}
              </span>
              <span>Velocidade: {replay.start.playbackSpeed.toFixed(2)}×</span>
              <span>Total de frames: {replay.start.totalFrames}</span>
              <span>Frame atual: {replay.lastFrame?.frame ?? 0}</span>
            </div>
            <pre className="max-h-64 overflow-auto rounded border bg-muted/30 p-3 text-xs">
              {JSON.stringify(replay.lastFrame ?? replay.start, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum replay ativo no momento.</p>
        )}
      </section>
    </div>
  );
};

export default MonitorPage;
