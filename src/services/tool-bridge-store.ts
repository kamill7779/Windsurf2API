import { randomUUID } from 'crypto';
import { ToolBridgeSession } from '../types.js';
import { loadData, saveData } from './store.js';

const DATA_KEY = 'tool_bridge_sessions';

let sessions: ToolBridgeSession[] | null = null;

function ensureLoaded(): void {
  if (sessions) return;
  sessions = loadData<ToolBridgeSession[]>(DATA_KEY, []);
}

function persist(): void {
  if (!sessions) return;
  saveData(DATA_KEY, sessions);
}

function now(): number {
  return Date.now();
}

export function createToolBridgeSession(input: {
  downstreamAuthKey: string;
  channelId: string;
  upstreamApiKey: string;
  modelKey: string;
  modelUid: string | null;
  modelEnum: number;
  sessionId: string;
  cascadeId: string;
  trajectoryId: string;
  plannerMode: number;
  proposalStepIndex: number;
  proposalStepCount: number;
  proposalStep: Buffer;
  proposalToolCallId: string;
  proposalToolName: string;
  proposalArgumentsJson: string;
  proposedCommandLine: string;
  mockToolName: 'Bash' | 'Write';
}): ToolBridgeSession {
  ensureLoaded();
  const timestamp = now();
  const session: ToolBridgeSession = {
    id: `bridge_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    downstreamAuthKey: input.downstreamAuthKey,
    channelId: input.channelId,
    upstreamApiKey: input.upstreamApiKey,
    modelKey: input.modelKey,
    modelUid: input.modelUid,
    modelEnum: input.modelEnum,
    sessionId: input.sessionId,
    cascadeId: input.cascadeId,
    trajectoryId: input.trajectoryId,
    plannerMode: input.plannerMode,
    proposalStepIndex: input.proposalStepIndex,
    proposalStepCount: input.proposalStepCount,
    proposalStepBase64: input.proposalStep.toString('base64'),
    proposalToolCallId: input.proposalToolCallId,
    proposalToolName: input.proposalToolName,
    proposalArgumentsJson: input.proposalArgumentsJson,
    proposedCommandLine: input.proposedCommandLine,
    mockToolName: input.mockToolName,
    interactionResolved: false,
    status: 'proposed',
    lastBridgePath: null,
    lastReplayMode: null,
    lastReplayError: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  sessions!.push(session);
  persist();
  return session;
}

export function getToolBridgeSession(id: string): ToolBridgeSession | null {
  ensureLoaded();
  return sessions!.find(session => session.id === id) || null;
}

export function findToolBridgeSessionByToolCallId(
  toolCallId: string,
  downstreamAuthKey?: string,
): ToolBridgeSession | null {
  ensureLoaded();
  return sessions!.find(session =>
    session.proposalToolCallId === toolCallId &&
    (!downstreamAuthKey || session.downstreamAuthKey === downstreamAuthKey),
  ) || null;
}

export function patchToolBridgeSession(
  id: string,
  patch: Partial<ToolBridgeSession>,
): ToolBridgeSession | null {
  ensureLoaded();
  const current = sessions!.find(session => session.id === id);
  if (!current) return null;
  Object.assign(current, patch, { updatedAt: now() });
  persist();
  return current;
}
