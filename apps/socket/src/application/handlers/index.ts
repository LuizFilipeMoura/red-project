import { createLobbyDefinition } from './createLobby.js';
import { listLobbiesDefinition } from './listLobbies.js';
import { joinLobbyDefinition } from './joinLobby.js';
import { leaveLobbyDefinition } from './leaveLobby.js';
import { startLobbyDefinition } from './startLobby.js';
import { passTurnDefinition } from './passTurn.js';
import type { HandlerDefinition } from '../registry.js';

export const handlerDefinitions: HandlerDefinition[] = [
  createLobbyDefinition,
  listLobbiesDefinition,
  joinLobbyDefinition,
  leaveLobbyDefinition,
  startLobbyDefinition,
  passTurnDefinition,
];
