/**
 * Game message types for the unified action sequence system (FEAT-346).
 *
 * A message IS an action. One server response emits a batch of GameMessage[].
 * Both client modes (chat, overhead) render from the same message list.
 */

import type { ClassifiedAction } from './action.js';
import type { BattleOutcome } from '../combat/battle.js';
import type { CheckDetail } from '../combat/ruleset.js';

export type MilestoneType =
  | 'location_entered'
  | 'goal_revealed'
  | 'goal_achieved'
  | 'goal_failed'
  | 'quest_received'
  | 'character_arrived'
  | 'character_departed'
  | 'skill_check'
  | 'contested_check'
  | 'incapacitation'
  | 'character_death'
  | 'combat_start'
  | 'combat_turn'
  | 'combat_end'
  | 'item_acquired'
  | 'item_used';

export interface MilestoneData {
  type: MilestoneType;
  label: string;
  subtext: string | null;
  entityId: string | null;
  checkDetail: CheckDetail | null;
  combatData: CombatMilestoneData | null;
}

export type CombatMilestoneData = CombatStartData | CombatTurnData | CombatEndData;

export interface CombatParticipantRef {
  id: string;
  name: string;
}

export interface CombatStartData {
  kind: 'combat_start';
  playerSide: CombatParticipantRef[];
  enemySide: CombatParticipantRef[];
  placeId: string;
}

export interface CombatTurnData {
  kind: 'combat_turn';
  round: number;
  actorName: string;
  actionName: string;
  targetName: string | null;
  outcome: 'success' | 'partial' | 'failure' | 'auto';
  damage: number | null;
  timingSuccess: boolean;
  defenseTimingSuccess: boolean;
  effects: string[];
}

export interface CombatEndData {
  kind: 'combat_end';
  outcome: BattleOutcome;
  rounds: number;
  participantSummaries: CombatParticipantSummary[];
}

export interface CombatParticipantSummary {
  participantId: string;
  name: string;
  finalState: 'standing' | 'incapacitated' | 'fled';
  damageDealt: number;
  damageTaken: number;
  conditionsGained: string[];
}

/** Sprite-level facing direction (matches LPC animation directions). */
export type FacingDirection = 'up' | 'down' | 'left' | 'right';

/** Common metadata shared by all game messages. */
interface GameMessageBase {
  date: string | null;
  omitFromTranscript: boolean;
  hidden: boolean;
}

export interface InputMessage extends GameMessageBase {
  role: 'user';
  action: 'input';
  opts: { text: string; classifiedActions?: ClassifiedAction[] };
}

export interface DialogMessage extends GameMessageBase {
  role: 'assistant';
  action: 'dialog';
  opts: { characterId: string; text: string };
}

export interface NarrationMessage extends GameMessageBase {
  role: 'assistant';
  action: 'narration';
  opts: { text: string };
}

export interface MoveMessage extends GameMessageBase {
  role: 'assistant';
  action: 'move';
  opts: {
    characterId: string;
    targetCharacterId?: string;
    x?: number;
    y?: number;
  };
}

export interface FaceMessage extends GameMessageBase {
  role: 'assistant';
  action: 'face';
  opts: {
    characterId: string;
    targetCharacterId?: string;
    direction?: FacingDirection;
  };
}

export interface WaitMessage extends GameMessageBase {
  role: 'assistant';
  action: 'wait';
  opts: { durationMs: number };
}

export interface ZoomMessage extends GameMessageBase {
  role: 'assistant';
  action: 'zoom';
  opts: {
    /** Target camera zoom level (1.0 = normal, >1.0 = zoom in). */
    targetZoom: number;
    /** Duration of the zoom tween in milliseconds. */
    durationMs: number;
    /** If true, camera will tween back to 1.0 at the end of the action sequence. */
    restoreAfter: boolean;
  };
}

export interface ShakeMessage extends GameMessageBase {
  role: 'assistant';
  action: 'shake';
  opts: {
    /** Duration of the shake in milliseconds. */
    durationMs: number;
    /** Normalized intensity 0.0–1.0 (scaled to Phaser units in executeShake). */
    intensity: number;
  };
}

export interface EmoteMessage extends GameMessageBase {
  role: 'assistant';
  action: 'emote';
  opts: { characterId: string; emote: string };
}

export interface EffectMessage extends GameMessageBase {
  role: 'assistant';
  action: 'effect';
  opts: { effect: string };
}

export interface MilestoneMessage extends GameMessageBase {
  role: 'assistant';
  action: 'milestone';
  opts: MilestoneData;
}

export interface AudioMessage extends GameMessageBase {
  role: 'assistant';
  action: 'audio';
  opts: { url: string; autoPlay: boolean };
}

export interface SystemMessage extends GameMessageBase {
  role: 'system';
  action: 'system';
  opts: { text: string };
}

export interface MoveHintMessage extends GameMessageBase {
  role: 'assistant';
  action: 'move_hint';
  opts: { targetId: string };
}

export interface CombatMessage extends GameMessageBase {
  role: 'assistant';
  action: 'combat';
  opts: { targetCharacterId: string };
}

/** Discriminated union of all game message types. */
export type GameMessage =
  | InputMessage
  | DialogMessage
  | NarrationMessage
  | MoveMessage
  | FaceMessage
  | WaitMessage
  | ZoomMessage
  | ShakeMessage
  | EmoteMessage
  | EffectMessage
  | MilestoneMessage
  | AudioMessage
  | SystemMessage
  | MoveHintMessage
  | CombatMessage;

/** Action discriminant values. */
export type GameMessageAction = GameMessage['action'];

/** Extract the message type for a given action. */
export type GameMessageFor<A extends GameMessageAction> = Extract<GameMessage, { action: A }>;

/** Messages that carry displayable text. */
export type TextGameMessage = InputMessage | DialogMessage | NarrationMessage | SystemMessage;

/** Type guard: does this message carry displayable text? */
export function isTextMessage(msg: GameMessage): msg is TextGameMessage {
  return (
    msg.action === 'input' ||
    msg.action === 'dialog' ||
    msg.action === 'narration' ||
    msg.action === 'system'
  );
}

/** Extract text from a message, if it has any. */
export function getMessageText(msg: GameMessage): string | null {
  switch (msg.action) {
    case 'input':
    case 'narration':
    case 'system':
      return msg.opts.text;
    case 'dialog':
      return msg.opts.text;
    default:
      return null;
  }
}

export interface DialogueChoice {
  id: string;
  label: string;
  content: string;
}
