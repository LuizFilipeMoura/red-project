import { jest } from '@jest/globals';
import {
  attachTimeout,
  createLobbyRow,
  createLobbyStore,
  type LobbyState,
} from '../state.js';
import { LOBBY_CAPACITY, TURN_TIMEOUT_MS } from '@repo/shared';
import { Mutex } from 'async-mutex';

describe('state helpers', () => {
  it('sanitizes lobby names and enforces defaults', () => {
    const row = createLobbyRow({ name: '  My@Lobby!! ', ownerSid: 'sid-1' });
    expect(row.name).toBe('MyLobby');
    expect(row.capacity).toBe(LOBBY_CAPACITY);
    expect(row.status).toBe('waiting');
    expect(row.ownerSid).toBe('sid-1');
  });

  it('attaches a timeout that fires', () => {
    jest.useFakeTimers();
    const store = createLobbyStore();
    const meta = createLobbyRow({ name: 'Test', ownerSid: 'owner' });
    const lobby: LobbyState = {
      meta,
      players: [
        { lobbyId: meta.id, sid: 'owner', joinedAt: Date.now(), isReady: false },
        { lobbyId: meta.id, sid: 'guest', joinedAt: Date.now(), isReady: false },
      ],
      currentPlayerSid: 'owner',
      turnNumber: 1,
      deadlineAt: null,
      mutex: new Mutex(),
    };
    store.set(lobby.meta.id, lobby);
    const onTimeout = jest.fn();
    attachTimeout(store, lobby.meta.id, onTimeout);
    expect(lobby.deadlineAt).not.toBeNull();
    jest.advanceTimersByTime(TURN_TIMEOUT_MS + 10);
    expect(onTimeout).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
