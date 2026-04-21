/**
 * Shared type definitions for Windsurf2Api
 */

// ─── Channel (upstream Windsurf account) ───

export interface Channel {
  id: string;
  email: string;
  apiKey: string;          // devin session token
  status: 'active' | 'error' | 'disabled';
  tier: string;
  errorCount: number;
  lastUsed: number;
  rpmHistory: number[];
  createdAt: number;
}

export interface ChannelPublic {
  id: string;
  email: string;
  status: 'active' | 'error' | 'disabled';
  tier: string;
  errorCount: number;
  lastUsed: number;
  rpm: number;
  createdAt: number;
}

// ─── Token (downstream API key) ───

export interface ApiToken {
  id: string;
  key: string;             // sk-w2a-xxx
  name: string;
  status: 'active' | 'disabled';
  createdAt: number;
  usedQuota: number;       // consumed tokens
  totalQuota: number;      // limit (0 = unlimited)
  allowedModels: string[]; // empty = all allowed
  reqCount: number;
}

// ─── Stats ───

export interface DailyStats {
  date: string;            // YYYY-MM-DD
  requests: number;
  tokens: number;
  byModel: Record<string, number>;
  byChannel: Record<string, number>;
  byToken: Record<string, number>;
}

export interface Stats {
  totalRequests: number;
  totalTokens: number;
  daily: DailyStats[];
  lastUpdated: number;
}

// ─── Model ───

export interface ModelInfo {
  name: string;
  provider: string;
  enumValue: number;
  modelUid: string | null;
  credit: number;
}

// ─── Chat Request/Response ───

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

// ─── Experimental Tool Bridge ───

export interface ToolBridgeSession {
  id: string;
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
  proposalStepBase64: string;
  proposalToolCallId: string;
  proposalToolName: string;
  proposalArgumentsJson: string;
  proposedCommandLine: string;
  mockToolName: 'Bash' | 'Write';
  interactionResolved: boolean;
  status: 'proposed' | 'replaying' | 'completed' | 'failed';
  lastBridgePath: 'interaction' | 'legacy_cancel' | null;
  lastReplayMode: 'additional_steps' | 'replay_ground_truth' | null;
  lastReplayError: string;
  createdAt: number;
  updatedAt: number;
}

export interface BashToolResultInput {
  bridgeId: string;
  toolCallId: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  success?: boolean;
}

export interface ToolBridgeObservation {
  status: number | null;
  newStepKinds: string[];
  newToolNames: string[];
  stepCount: number;
}

export interface ToolBridgeSubmissionResult {
  bridgeId: string;
  accepted: boolean;
  bridgePath: 'interaction' | 'legacy_cancel';
  modeTried: 'interaction' | 'additional_steps' | 'replay_ground_truth' | null;
  advanced: boolean;
  observation: ToolBridgeObservation;
  text: string;
  thinking: string;
  submittedCommandLine?: string;
  error?: string;
}
