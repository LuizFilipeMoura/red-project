import { io, type Socket } from 'socket.io-client';
import { EVENTS, makeMsg, type MatchState, type StateSync } from '@repo/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';

export type GameAction =
  | { type: 'moveUnit'; unitId: string; toX: number; toY: number }
  | { type: 'playUnit'; cardId: string; x: number; y: number }
  | { type: 'playSpell'; cardId: string; anchorX: number; anchorY: number }
  | { type: 'playTalent'; cardId: string; targetX: number; targetY: number }
  | { type: 'endTurn' };

export type GameResult = {
  win: boolean;
  turns: number;
  score: number;
  trace: Array<{
    frame: number;
    timestamp: number;
    match: MatchState | null;
    action?: { type: string; payload: unknown };
  }>;
};

export class GameClient {
  private socket?: Socket;
  private lobbyId?: string;
  private sid?: string;
  private currentState?: StateSync;
  private stateUpdates: StateSync[] = [];
  private actions: Array<{ type: string; payload: unknown; timestamp: number }> = [];
  private resolveConnection?: (socket: Socket) => void;
  private rejectConnection?: (error: Error) => void;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info({ url: env.GA_SOCKET_URL }, 'GameClient connecting to socket');
      this.socket = io(env.GA_SOCKET_URL, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
      });

      this.socket.on('connect', () => {
        logger.info({ socketId: this.socket?.id, connected: this.socket?.connected }, 'GameClient connected successfully');
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        logger.error({ err: error, message: error.message }, 'GameClient connection error');
        reject(error);
      });

      this.socket.on('error', (error) => {
        logger.error({ err: error }, 'GameClient socket error');
      });

      this.socket.on(EVENTS.STATE_SYNC, (payload: unknown) => {
        // logger.info({ socketId: this.socket?.id, rawPayload: typeof payload }, 'STATE_SYNC event received');

        // Unwrap the message envelope if needed
        let state: StateSync;
        if (payload && typeof payload === 'object' && 'payload' in payload) {
          // It's wrapped in a message envelope
          state = (payload as any).payload as StateSync;
          logger.debug({ socketId: this.socket?.id }, 'Unwrapped message envelope');
        } else {
          state = payload as StateSync;
        }

        this.currentState = state;
        this.sid = state.yourSid;
        this.stateUpdates.push(state);
        // logger.info(
        //   {
        //     socketId: this.socket?.id,
        //     lobbyId: state.lobby?.id,
        //     hasMatch: !!state.match,
        //     turnNumber: state.match?.turnNumber,
        //     currentPlayer: state.match?.currentPlayerSid,
        //     yourSid: state.yourSid,
        //   },
        //   'GameClient STATE_SYNC processed and stored',
        // );
      });

      this.socket.on(EVENTS.ERROR, (payload: unknown) => {
        const error = payload as { code: string; message: string };
        logger.error({ error }, 'GameClient received error from server');
      });
    });
  }

  async createLobby(name: string): Promise<string> {
    if (!this.socket) throw new Error('Not connected');

    logger.info({ name, socketId: this.socket.id }, 'Attempting to create lobby');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.error(
          {
            name,
            socketId: this.socket?.id,
            currentStateHasLobby: !!this.currentState?.lobby,
            stateUpdatesCount: this.stateUpdates.length,
          },
          'Lobby creation timeout - no STATE_SYNC received',
        );
        reject(new Error('Lobby creation timeout'));
      }, 10000);

      // Don't add another listener - use the global STATE_SYNC listener
      // Instead, check the currentState periodically
      const checkInterval = setInterval(() => {
        if (this.currentState?.lobby) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          this.lobbyId = this.currentState.lobby.id;
          logger.info({ lobbyId: this.lobbyId, socketId: this.socket?.id }, 'GameClient created lobby successfully');
          resolve(this.lobbyId);
        }
      }, 50);

      logger.info({ name, isPrivate: true, socketId: this.socket!.id }, 'Emitting lobby:create event');
      this.socket!.emit('lobby:create', makeMsg('lobby:create', { name, isPrivate: true }));
    });
  }

  async joinLobby(lobbyId: string): Promise<void> {
    if (!this.socket) throw new Error('Not connected');

    logger.info({ lobbyId, socketId: this.socket.id }, 'Attempting to join lobby');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.error(
          {
            lobbyId,
            socketId: this.socket?.id,
            currentLobbyId: this.currentState?.lobby?.id,
          },
          'Lobby join timeout',
        );
        reject(new Error('Lobby join timeout'));
      }, 10000);

      // Use polling instead of duplicate listener
      const checkInterval = setInterval(() => {
        if (this.currentState?.lobby?.id === lobbyId) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          this.lobbyId = lobbyId;
          logger.info({ lobbyId, sid: this.sid, socketId: this.socket?.id }, 'GameClient joined lobby');
          resolve();
        }
      }, 50);

      logger.info({ lobbyId, socketId: this.socket!.id }, 'Emitting lobby:join event');
      this.socket!.emit('lobby:join', makeMsg('lobby:join', { lobbyId }));
    });
  }

  async startGame(): Promise<void> {
    if (!this.socket || !this.lobbyId) throw new Error('Not in a lobby');

    logger.info({ lobbyId: this.lobbyId, socketId: this.socket.id }, 'Attempting to start game');

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.error(
          {
            lobbyId: this.lobbyId,
            socketId: this.socket?.id,
            currentStatus: this.currentState?.lobby?.status,
            hasMatch: !!this.currentState?.match,
          },
          'Game start timeout',
        );
        reject(new Error('Game start timeout'));
      }, 10000);

      // Use polling instead of duplicate listener
      const checkInterval = setInterval(() => {
        if (this.currentState?.lobby?.status === 'started' && this.currentState?.match) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          logger.info({ lobbyId: this.lobbyId, socketId: this.socket?.id }, 'GameClient game started');
          resolve();
        }
      }, 50);

      logger.info({ lobbyId: this.lobbyId!, socketId: this.socket!.id }, 'Emitting lobby:start event');
      this.socket!.emit('lobby:start', makeMsg('lobby:start', { lobbyId: this.lobbyId! }));
    });
  }

  async executeAction(action: GameAction): Promise<void> {
    if (!this.socket || !this.lobbyId) throw new Error('Not in a game');

    const timestamp = Date.now();

    switch (action.type) {
      case 'moveUnit':
        this.actions.push({
          type: EVENTS.GAME_MOVE_UNIT,
          payload: { lobbyId: this.lobbyId, unitId: action.unitId, toX: action.toX, toY: action.toY },
          timestamp,
        });
        this.socket.emit(
          EVENTS.GAME_MOVE_UNIT,
          makeMsg(EVENTS.GAME_MOVE_UNIT, {
            lobbyId: this.lobbyId,
            unitId: action.unitId,
            toX: action.toX,
            toY: action.toY,
          }),
        );
        break;

      case 'playUnit':
        this.actions.push({
          type: EVENTS.CARD_PLAY_UNIT,
          payload: { lobbyId: this.lobbyId, cardId: action.cardId, x: action.x, y: action.y },
          timestamp,
        });
        this.socket.emit(
          EVENTS.CARD_PLAY_UNIT,
          makeMsg(EVENTS.CARD_PLAY_UNIT, {
            lobbyId: this.lobbyId,
            cardId: action.cardId,
            x: action.x,
            y: action.y,
          }),
        );
        break;

      case 'playSpell':
        this.actions.push({
          type: EVENTS.CARD_PLAY_SPELL,
          payload: {
            lobbyId: this.lobbyId,
            cardId: action.cardId,
            anchorX: action.anchorX,
            anchorY: action.anchorY,
          },
          timestamp,
        });
        this.socket.emit(
          EVENTS.CARD_PLAY_SPELL,
          makeMsg(EVENTS.CARD_PLAY_SPELL, {
            lobbyId: this.lobbyId,
            cardId: action.cardId,
            anchorX: action.anchorX,
            anchorY: action.anchorY,
          }),
        );
        break;

      case 'playTalent':
        this.actions.push({
          type: EVENTS.CARD_PLAY_TALENT,
          payload: {
            lobbyId: this.lobbyId,
            cardId: action.cardId,
            targetX: action.targetX,
            targetY: action.targetY,
          },
          timestamp,
        });
        this.socket.emit(
          EVENTS.CARD_PLAY_TALENT,
          makeMsg(EVENTS.CARD_PLAY_TALENT, {
            lobbyId: this.lobbyId,
            cardId: action.cardId,
            targetX: action.targetX,
            targetY: action.targetY,
          }),
        );
        break;

      case 'endTurn':
        this.actions.push({
          type: EVENTS.GAME_END_TURN,
          payload: { lobbyId: this.lobbyId },
          timestamp,
        });
        this.socket.emit(EVENTS.GAME_END_TURN, makeMsg(EVENTS.GAME_END_TURN, { lobbyId: this.lobbyId }));
        break;
    }

    // Wait for state update to propagate
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  async waitForGameEnd(maxTurns: number = 90): Promise<GameResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Game timeout')), 75_000); // 3 minutes max

      const checkInterval = setInterval(() => {
        const match = this.currentState?.match;

        // Check if game ended with a winner
        if (match?.winnerSid) {
          clearInterval(checkInterval);
          clearTimeout(timeout);

          const win = match.winnerSid === this.sid;
          const turns = match.turnNumber;

          // Calculate score based on distance to enemy flag
          const score = this.calculateFlagProximityScore(match, turns);

          // Build trace from state updates and actions
          const trace = this.stateUpdates.map((state, index) => ({
            frame: index,
            timestamp: Date.now() + index * 150,
            match: state.match,
            action: this.actions[index],
          }));

          logger.info({ win, turns, score, sid: this.sid }, 'GameClient game ended with winner');

          resolve({ win, turns, score, trace });
        }

        // Check if game reached max turns (both players lose)
        if (match && match.turnNumber >= maxTurns) {
          clearInterval(checkInterval);
          clearTimeout(timeout);

          const turns = match.turnNumber;
          const score = this.calculateFlagProximityScore(match, turns);

          // Build trace from state updates and actions
          const trace = this.stateUpdates.map((state, index) => ({
            frame: index,
            timestamp: Date.now() + index * 150,
            match: state.match,
            action: this.actions[index],
          }));

          logger.info({ turns, score, sid: this.sid, maxTurns }, 'GameClient game ended at max turns - both lose');

          resolve({ win: false, turns, score, trace });
        }
      }, 100);
    });
  }

  private calculateFlagProximityScore(match: any, turns: number): number {
    // Get player's units
    const myUnits = match.units.filter((unit: any) => unit.owner === this.sid);

    if (myUnits.length === 0) {
      return -200; // No units left, worst score
    }

    // Determine which flag is the enemy's
    // Side A starts at rows 0-3 with flag at (0,0), enemy flag is B at (7,7)
    // Side B starts at rows 4-7 with flag at (7,7), enemy flag is A at (0,0)
    const isPlayerA = myUnits.some((unit: any) => unit.y <= 3);
    const enemyFlag = isPlayerA ? { x: 7, y: 7 } : { x: 0, y: 0 };

    // Find minimum distance from any unit to enemy flag (Manhattan distance)
    const minDistance = Math.min(
      ...myUnits.map((unit: any) =>
        Math.abs(unit.x - enemyFlag.x) + Math.abs(unit.y - enemyFlag.y)
      )
    );

    // Score: closer to flag = higher score, fewer turns = higher score
    // Max distance on 8x8 board is 14 (from corner to corner)
    // Base score: (14 - distance) * 10 = 0 to 140
    // Turn penalty: -turns (to reward getting there faster)
    const distanceScore = (14 - minDistance) * 10;
    const turnPenalty = turns * 0.5;

    return distanceScore - turnPenalty;
  }

  getCurrentState(): StateSync | undefined {
    return this.currentState;
  }

  getSid(): string | undefined {
    return this.sid;
  }

  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = undefined;
      logger.debug('GameClient disconnected');
    }
  }
}
