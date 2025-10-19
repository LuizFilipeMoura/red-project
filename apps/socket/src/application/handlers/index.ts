import {
  createLobbyDefinition,
  joinLobbyDefinition,
  leaveLobbyDefinition,
  listLobbiesDefinition,
  startLobbyDefinition,
} from './lobby/index.js';
import { endTurnDefinition, moveUnitDefinition } from './game/index.js';
import { playUnitDefinition, playSpellDefinition, playTalentDefinition } from './card/index.js';
import { gaHandlerDefinitions } from './ga/index.js';
import type { HandlerDefinition } from '../registry.js';

export const handlerDefinitions: HandlerDefinition[] = [
  // Lobby management
  createLobbyDefinition,
  listLobbiesDefinition,
  joinLobbyDefinition,
  leaveLobbyDefinition,
  startLobbyDefinition,

  // Game actions
  moveUnitDefinition,
  endTurnDefinition,

  // Card actions
  playUnitDefinition,
  playSpellDefinition,
  playTalentDefinition,

  // GA orchestration
  ...gaHandlerDefinitions,
];
