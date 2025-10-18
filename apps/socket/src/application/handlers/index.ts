import { createLobbyDefinition } from './createLobby.js';
import { listLobbiesDefinition } from './listLobbies.js';
import { joinLobbyDefinition } from './joinLobby.js';
import { leaveLobbyDefinition } from './leaveLobby.js';
import { startLobbyDefinition } from './startLobby.js';
import { passTurnDefinition } from './passTurn.js';
import { endTurnDefinition, moveUnitDefinition } from './game/index.js';
import { playUnitDefinition } from './card/playUnit.js';
import { playSpellDefinition } from './card/playSpell.js';
import { playTalentDefinition } from './card/playTalent.js';
import type { HandlerDefinition } from '../registry.js';

export const handlerDefinitions: HandlerDefinition[] = [
  createLobbyDefinition,
  listLobbiesDefinition,
  joinLobbyDefinition,
  leaveLobbyDefinition,
  startLobbyDefinition,
  passTurnDefinition,
  moveUnitDefinition,
  endTurnDefinition,
  playUnitDefinition,
  playSpellDefinition,
  playTalentDefinition,
];
