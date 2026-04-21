/**
 * Protobuf message builders and parsers for Windsurf language server.
 * Ported from WindsurfAPI/src/windsurf.js (simplified MVP version).
 */

import { randomUUID } from 'crypto';
import {
  writeVarintField, writeStringField, writeMessageField,
  writeBoolField, parseFields, getField, getAllFields,
} from './proto.js';

const SOURCE = { USER: 1, SYSTEM: 2, ASSISTANT: 3, TOOL: 4 };

const STEP_KIND_FIELDS: Record<number, string> = {
  19: 'user_input',
  20: 'planner_response',
  23: 'write_to_file',
  24: 'error_message',
  28: 'run_command',
  37: 'command_status',
  45: 'custom_tool',
  47: 'mcp_tool',
  49: 'tool_call_proposal',
  50: 'tool_call_choice',
};

const REQUESTED_INTERACTION_FIELDS: Record<number, string> = {
  2: 'deploy',
  3: 'run_command',
  5: 'run_extension_code',
  11: 'resolve_task',
  13: 'upsert_codemap',
  14: 'read_url_content',
  15: 'ask_user_question',
};

export enum PlannerMode {
  UNSPECIFIED = 0,
  DEFAULT = 1,
  READ_ONLY = 2,
  NO_TOOL = 3,
  EXPLORE = 4,
  PLANNING = 5,
  AUTO = 6,
}

export enum RunCommandAction {
  UNSPECIFIED = 0,
  CONFIRM = 1,
  REJECT = 2,
  SKIP = 3,
}

export interface CascadeConfigOptions {
  plannerMode?: PlannerMode;
  communicationText?: string;
  includeCommunicationOverride?: boolean;
  toolPreamble?: string;
}

export interface ChatToolCallInfo {
  id: string;
  name: string;
  argumentsJson: string;
  invalidJsonStr: string;
  invalidJsonErr: string;
  isCustomToolCall: boolean;
}

export interface TrajectoryRunCommandInfo {
  commandId: string;
  commandLine: string;
  proposedCommandLine: string;
  cwd: string;
  stdout: string;
  stderr: string;
  combinedOutput: string;
  exitCode: number | null;
  userRejected: boolean;
  shellName: string;
}

export interface TrajectoryCommandStatusInfo {
  commandId: string;
  status: number;
  combined: string;
  delta: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  errorText: string;
}

export interface ReplayTrajectorySummary {
  trajectoryId: string;
  cascadeId: string;
  stepCount: number;
  conversationalMode: number | null;
}

export interface RunCommandInteractionInput {
  cascadeId: string;
  trajectoryId: string;
  stepIndex: number;
  action: RunCommandAction;
  proposedCommandLine: string;
  submittedCommandLine?: string;
}

export interface TrajectoryStep {
  type: number;
  status: number;
  stepKind: string | null;
  text: string;
  thinking: string;
  errorText: string;
  toolCalls: ChatToolCallInfo[];
  usage: any;
  requestedInteraction: string | null;
  runCommand: TrajectoryRunCommandInfo | null;
  commandStatus: TrajectoryCommandStatusInfo | null;
  customTool: { recipeId: string; recipeName: string; argumentsJson: string; output: string } | null;
  mcpTool: { serverName: string; toolCall: ChatToolCallInfo | null; resultString: string } | null;
  rawStep: Buffer;
  rawFields: Array<{ field: number; wireType: number; preview: string | number }>;
}

function encodeTimestamp(): Buffer {
  const now = Date.now();
  const secs = Math.floor(now / 1000);
  const nanos = (now % 1000) * 1_000_000;
  const parts = [writeVarintField(1, secs)];
  if (nanos > 0) parts.push(writeVarintField(2, nanos));
  return Buffer.concat(parts);
}

export function buildMetadata(apiKey: string, version = '1.9600.41', sessionId: string | null = null): Buffer {
  return Buffer.concat([
    writeStringField(1, 'windsurf'),
    writeStringField(2, version),
    writeStringField(3, apiKey),
    writeStringField(4, 'en'),
    writeStringField(5, 'linux'),
    writeStringField(7, version),
    writeStringField(8, 'x86_64'),
    writeVarintField(9, Date.now()),
    writeStringField(10, sessionId || randomUUID()),
    writeStringField(12, 'windsurf'),
  ]);
}

function buildChatMessage(content: string, source: number, conversationId: string): Buffer {
  const parts = [
    writeStringField(1, randomUUID()),
    writeVarintField(2, source),
    writeMessageField(3, encodeTimestamp()),
    writeStringField(4, conversationId),
  ];
  if (source === SOURCE.ASSISTANT) {
    parts.push(writeStringField(5, content));
  } else {
    const intentGeneric = writeStringField(1, content);
    const intent = writeMessageField(1, intentGeneric);
    parts.push(writeMessageField(5, intent));
  }
  return Buffer.concat(parts);
}

export function buildRawGetChatMessageRequest(apiKey: string, messages: any[], modelEnum: number, modelName?: string): Buffer {
  const parts: Buffer[] = [];
  const conversationId = randomUUID();
  parts.push(writeMessageField(1, buildMetadata(apiKey)));

  let systemPrompt = '';
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n' : '') + String(msg.content);
      continue;
    }
    let source: number;
    switch (msg.role) {
      case 'user': source = SOURCE.USER; break;
      case 'assistant': source = SOURCE.ASSISTANT; break;
      case 'tool': source = SOURCE.TOOL; break;
      default: source = SOURCE.USER;
    }
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    parts.push(writeMessageField(2, buildChatMessage(text, source, conversationId)));
  }

  if (systemPrompt) parts.push(writeStringField(3, systemPrompt));
  parts.push(writeVarintField(4, modelEnum));
  if (modelName) parts.push(writeStringField(5, modelName));
  return Buffer.concat(parts);
}

export function parseRawResponse(buf: Buffer): { text: string; inProgress: boolean; isError: boolean } {
  const fields = parseFields(buf);
  const f1 = getField(fields, 1, 2);
  if (!f1) return { text: '', inProgress: false, isError: false };
  const inner = parseFields(f1.value as Buffer);
  const text = getField(inner, 5, 2);
  const inProgress = getField(inner, 6, 0);
  const isError = getField(inner, 7, 0);
  return {
    text: text ? (text.value as Buffer).toString('utf8') : '',
    inProgress: inProgress ? !!(inProgress.value as number) : false,
    isError: isError ? !!(isError.value as number) : false,
  };
}

// ─── Cascade flow ──────────────────────────────────────────

export function buildInitializePanelStateRequest(apiKey: string, sessionId: string, trusted = true): Buffer {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    writeBoolField(3, trusted),
  ]);
}

export function buildAddTrackedWorkspaceRequest(_apiKey: string, workspacePath: string, _sessionId: string): Buffer {
  return writeStringField(1, workspacePath);
}

export function buildUpdateWorkspaceTrustRequest(apiKey: string, _ignored: any, trusted = true, sessionId: string): Buffer {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    writeBoolField(2, trusted),
  ]);
}

export function buildStartCascadeRequest(apiKey: string, sessionId: string): Buffer {
  return writeMessageField(1, buildMetadata(apiKey, undefined, sessionId));
}

export function parseStartCascadeResponse(buf: Buffer): string {
  const fields = parseFields(buf);
  const f1 = getField(fields, 1, 2);
  return f1 ? (f1.value as Buffer).toString('utf8') : '';
}

function previewFieldValue(field: { wireType: number; value: number | Buffer }): string | number {
  if (field.wireType !== 2) return field.value as number;
  const buf = field.value as Buffer;
  const utf8 = buf.toString('utf8').replace(/\0/g, '').trim();
  if (utf8) return utf8.slice(0, 300);
  return buf.subarray(0, 32).toString('hex');
}

function parseChatToolCall(buf: Buffer): ChatToolCallInfo {
  const fields = parseFields(buf);
  const readString = (fieldNum: number) => {
    const field = getField(fields, fieldNum, 2);
    return field ? (field.value as Buffer).toString('utf8') : '';
  };
  const customField = getField(fields, 6, 0);
  return {
    id: readString(1),
    name: readString(2),
    argumentsJson: readString(3),
    invalidJsonStr: readString(4),
    invalidJsonErr: readString(5),
    isCustomToolCall: customField ? !!(customField.value as number) : false,
  };
}

function readErrorText(buf: Buffer): string {
  const errorFields = parseFields(buf);
  for (const fieldNum of [1, 2, 3, 5]) {
    const field = getField(errorFields, fieldNum, 2);
    if (!field) continue;
    const text = (field.value as Buffer).toString('utf8').trim();
    if (text) return text.split('\n')[0].slice(0, 300);
  }
  return '';
}

function parseRequestedInteraction(buf: Buffer): string | null {
  const fields = parseFields(buf);
  for (const [fieldNum, name] of Object.entries(REQUESTED_INTERACTION_FIELDS)) {
    if (getField(fields, Number(fieldNum), 2)) return name;
  }
  return null;
}

function detectStepKind(fields: ReturnType<typeof parseFields>): string | null {
  for (const [fieldNum, name] of Object.entries(STEP_KIND_FIELDS)) {
    if (getField(fields, Number(fieldNum), 2)) return name;
  }
  return null;
}

export function buildTextItem(text: string): Buffer {
  return writeStringField(1, text);
}

export function buildCascadeConfig(
  modelEnum: number,
  modelUid: string | null,
  options: CascadeConfigOptions = {},
): Buffer {
  const plannerMode = options.plannerMode ?? PlannerMode.NO_TOOL;
  const communicationText = options.communicationText ?? (
    options.toolPreamble
      ? 'You are an AI assistant accessed via API with the tool-calling capabilities described above.'
      : 'You are an AI assistant accessed via API.'
  );
  const includeCommunicationOverride = options.includeCommunicationOverride ?? true;

  const convParts = [writeVarintField(4, plannerMode)];

  if (options.toolPreamble) {
    const additionalInstructionsSection = Buffer.concat([
      writeVarintField(1, 1),
      writeStringField(
        2,
        `${options.toolPreamble}\n\nIMPORTANT: You have real, callable functions described above. When a request requires a function call, emit <tool_call> blocks exactly as specified and do not claim tool access is unavailable.`,
      ),
    ]);
    convParts.push(writeMessageField(12, additionalInstructionsSection));

    const toolCallingSection = Buffer.concat([
      writeVarintField(1, 1),
      writeStringField(2, options.toolPreamble),
    ]);
    convParts.push(writeMessageField(10, toolCallingSection));
  }

  // Minimal override
  if (includeCommunicationOverride) {
    const communicationOverride = Buffer.concat([
      writeVarintField(1, 1),
      writeStringField(2, communicationText),
    ]);
    convParts.push(writeMessageField(13, communicationOverride));
  }

  const conversationalConfig = Buffer.concat(convParts);
  const plannerParts = [writeMessageField(2, conversationalConfig)];

  if (modelUid) {
    plannerParts.push(writeStringField(35, modelUid));
  } else {
    plannerParts.push(writeMessageField(15, writeVarintField(1, modelEnum)));
  }

  const plannerConfig = Buffer.concat(plannerParts);
  const brainConfig = Buffer.concat([
    writeVarintField(1, 1),
    writeMessageField(6, writeMessageField(6, Buffer.alloc(0))),
  ]);

  return Buffer.concat([
    writeMessageField(1, plannerConfig),
    writeMessageField(7, brainConfig),
  ]);
}

export function buildSendCascadeMessageRequest(
  apiKey: string, cascadeId: string, text: string,
  modelEnum: number, modelUid: string | null, sessionId: string,
  options: CascadeConfigOptions = {},
): Buffer {
  return buildSendCascadeMessageRequestWithItems(
    apiKey,
    cascadeId,
    [buildTextItem(text)],
    modelEnum,
    modelUid,
    sessionId,
    options,
  );
}

export function buildSendCascadeMessageRequestWithItems(
  apiKey: string,
  cascadeId: string,
  items: Buffer[],
  modelEnum: number,
  modelUid: string | null,
  sessionId: string,
  options: CascadeConfigOptions = {},
  additionalSteps: Buffer[] = [],
): Buffer {
  const parts = [
    writeStringField(1, cascadeId),
    ...items.map(item => writeMessageField(2, item)),
    writeMessageField(3, buildMetadata(apiKey, undefined, sessionId)),
    writeMessageField(5, buildCascadeConfig(modelEnum, modelUid, options)),
  ];
  for (const step of additionalSteps) {
    parts.push(writeMessageField(9, step));
  }
  return Buffer.concat(parts);
}

export function buildReplayGroundTruthTrajectoryRequest(
  apiKey: string,
  cascadeId: string,
  replaySteps: Buffer[],
  modelEnum: number,
  modelUid: string | null,
  sessionId: string,
  options: CascadeConfigOptions = {},
): Buffer {
  return Buffer.concat([
    writeMessageField(1, buildMetadata(apiKey, undefined, sessionId)),
    ...replaySteps.map(step => writeMessageField(2, step)),
    writeStringField(3, cascadeId),
    writeMessageField(4, buildCascadeConfig(modelEnum, modelUid, options)),
  ]);
}

export function buildGetTrajectoryStepsRequest(cascadeId: string, stepOffset = 0): Buffer {
  const parts = [writeStringField(1, cascadeId)];
  if (stepOffset > 0) parts.push(writeVarintField(2, stepOffset));
  return Buffer.concat(parts);
}

export function buildGetTrajectoryRequest(cascadeId: string): Buffer {
  return writeStringField(1, cascadeId);
}

export function parseTrajectoryStatus(buf: Buffer): number {
  const fields = parseFields(buf);
  const f2 = getField(fields, 2, 0);
  return f2 ? (f2.value as number) : 0;
}

export function parseCascadeTrajectoryId(buf: Buffer): string {
  const fields = parseFields(buf);
  const trajectoryField = getField(fields, 1, 2);
  if (!trajectoryField) return '';
  const trajectoryFields = parseFields(trajectoryField.value as Buffer);
  const trajectoryIdField = getField(trajectoryFields, 1, 2);
  return trajectoryIdField ? (trajectoryIdField.value as Buffer).toString('utf8') : '';
}

export function buildHandleRunCommandInteractionRequest(input: RunCommandInteractionInput): Buffer {
  const runCommandParts: Buffer[] = [
    writeVarintField(1, input.action === RunCommandAction.REJECT || input.action === RunCommandAction.SKIP ? 0 : 1),
    writeStringField(2, input.proposedCommandLine),
    writeVarintField(4, input.action),
  ];

  if (input.submittedCommandLine != null && input.submittedCommandLine !== '') {
    runCommandParts.push(writeStringField(3, input.submittedCommandLine));
  }

  const interaction = Buffer.concat([
    writeStringField(1, input.trajectoryId),
    writeVarintField(2, input.stepIndex),
    writeMessageField(5, Buffer.concat(runCommandParts)),
  ]);

  return Buffer.concat([
    writeStringField(1, input.cascadeId),
    writeMessageField(2, interaction),
  ]);
}

export function parseReplayGroundTruthTrajectoryResponse(buf: Buffer): ReplayTrajectorySummary {
  const fields = parseFields(buf);
  const trajectoryField = getField(fields, 1, 2);
  if (!trajectoryField) {
    return {
      trajectoryId: '',
      cascadeId: '',
      stepCount: 0,
      conversationalMode: null,
    };
  }

  const trajectoryFields = parseFields(trajectoryField.value as Buffer);
  const trajectoryIdField = getField(trajectoryFields, 1, 2);
  const cascadeIdField = getField(trajectoryFields, 6, 2);
  const steps = getAllFields(trajectoryFields, 2).filter(field => field.wireType === 2);
  const conversationalModeField = getField(trajectoryFields, 21, 0);

  return {
    trajectoryId: trajectoryIdField ? (trajectoryIdField.value as Buffer).toString('utf8') : '',
    cascadeId: cascadeIdField ? (cascadeIdField.value as Buffer).toString('utf8') : '',
    stepCount: steps.length,
    conversationalMode: conversationalModeField ? (conversationalModeField.value as number) : null,
  };
}

export function parseTrajectorySteps(buf: Buffer): TrajectoryStep[] {
  const fields = parseFields(buf);
  const steps = getAllFields(fields, 1).filter(f => f.wireType === 2);
  const results: TrajectoryStep[] = [];

  for (const step of steps) {
    const sf = parseFields(step.value as Buffer);
    const typeField = getField(sf, 1, 0);
    const statusField = getField(sf, 4, 0);
    const plannerField = getField(sf, 20, 2);
    const stepKind = detectStepKind(sf);

    const entry: TrajectoryStep = {
      type: typeField ? (typeField.value as number) : 0,
      status: statusField ? (statusField.value as number) : 0,
      stepKind,
      text: '',
      thinking: '',
      errorText: '',
      toolCalls: [],
      usage: null,
      requestedInteraction: null,
      runCommand: null,
      commandStatus: null,
      customTool: null,
      mcpTool: null,
      rawStep: step.value as Buffer,
      rawFields: sf.map(field => ({
        field: field.field,
        wireType: field.wireType,
        preview: previewFieldValue(field),
      })),
    };

    const errMsgField = getField(sf, 24, 2);
    if (errMsgField) {
      const inner = getField(parseFields(errMsgField.value as Buffer), 3, 2);
      if (inner) entry.errorText = readErrorText(inner.value as Buffer);
    }
    if (!entry.errorText) {
      const errField = getField(sf, 31, 2);
      if (errField) entry.errorText = readErrorText(errField.value as Buffer);
    }

    if (plannerField) {
      const pf = parseFields(plannerField.value as Buffer);
      const textField = getField(pf, 1, 2);
      const modifiedField = getField(pf, 8, 2);
      const thinkField = getField(pf, 3, 2);
      const responseText = textField ? (textField.value as Buffer).toString('utf8') : '';
      const modifiedText = modifiedField ? (modifiedField.value as Buffer).toString('utf8') : '';
      entry.text = modifiedText || responseText;
      if (thinkField) entry.thinking = (thinkField.value as Buffer).toString('utf8');
    }

    const requestedInteractionField = getField(sf, 56, 2);
    if (requestedInteractionField) {
      entry.requestedInteraction = parseRequestedInteraction(requestedInteractionField.value as Buffer);
    }

    const proposalField = getField(sf, 49, 2);
    if (proposalField) {
      const proposalFields = parseFields(proposalField.value as Buffer);
      const callField = getField(proposalFields, 1, 2);
      if (callField) entry.toolCalls.push(parseChatToolCall(callField.value as Buffer));
    }

    const choiceField = getField(sf, 50, 2);
    if (choiceField) {
      const choiceFields = parseFields(choiceField.value as Buffer);
      const callFields = getAllFields(choiceFields, 1).filter(field => field.wireType === 2);
      for (const callField of callFields) {
        entry.toolCalls.push(parseChatToolCall(callField.value as Buffer));
      }
    }

    const runCommandField = getField(sf, 28, 2);
    if (runCommandField) {
      const commandFields = parseFields(runCommandField.value as Buffer);
      const readString = (fieldNum: number) => {
        const field = getField(commandFields, fieldNum, 2);
        return field ? (field.value as Buffer).toString('utf8') : '';
      };
      const exitCodeField = getField(commandFields, 6, 0);
      const combinedField = getField(commandFields, 21, 2);
      const combinedFields = combinedField ? parseFields(combinedField.value as Buffer) : [];
      const combinedOutputField = getField(combinedFields, 1, 2);
      entry.runCommand = {
        commandId: readString(13),
        commandLine: readString(23),
        proposedCommandLine: readString(25),
        cwd: readString(2),
        stdout: readString(4),
        stderr: readString(5),
        combinedOutput: combinedOutputField ? (combinedOutputField.value as Buffer).toString('utf8') : '',
        exitCode: exitCodeField ? (exitCodeField.value as number) : null,
        userRejected: !!(getField(commandFields, 14, 0)?.value as number | undefined),
        shellName: readString(28),
      };
    }

    const commandStatusField = getField(sf, 37, 2);
    if (commandStatusField) {
      const statusFields = parseFields(commandStatusField.value as Buffer);
      const readString = (fieldNum: number) => {
        const field = getField(statusFields, fieldNum, 2);
        return field ? (field.value as Buffer).toString('utf8') : '';
      };
      const statusErrorField = getField(statusFields, 6, 2);
      entry.commandStatus = {
        commandId: readString(1),
        status: (getField(statusFields, 2, 0)?.value as number | undefined) ?? 0,
        combined: readString(9),
        delta: readString(12),
        stdout: readString(3),
        stderr: readString(4),
        exitCode: getField(statusFields, 5, 0) ? (getField(statusFields, 5, 0)?.value as number) : null,
        errorText: statusErrorField ? readErrorText(statusErrorField.value as Buffer) : '',
      };
    }

    const customToolField = getField(sf, 45, 2);
    if (customToolField) {
      const customToolFields = parseFields(customToolField.value as Buffer);
      const readString = (fieldNum: number) => {
        const field = getField(customToolFields, fieldNum, 2);
        return field ? (field.value as Buffer).toString('utf8') : '';
      };
      entry.customTool = {
        recipeId: readString(1),
        argumentsJson: readString(2),
        output: readString(3),
        recipeName: readString(4),
      };
    }

    const mcpToolField = getField(sf, 47, 2);
    if (mcpToolField) {
      const mcpFields = parseFields(mcpToolField.value as Buffer);
      const serverNameField = getField(mcpFields, 1, 2);
      const toolCallField = getField(mcpFields, 2, 2);
      const resultField = getField(mcpFields, 3, 2);
      entry.mcpTool = {
        serverName: serverNameField ? (serverNameField.value as Buffer).toString('utf8') : '',
        toolCall: toolCallField ? parseChatToolCall(toolCallField.value as Buffer) : null,
        resultString: resultField ? (resultField.value as Buffer).toString('utf8') : '',
      };
      if (entry.mcpTool.toolCall) entry.toolCalls.push(entry.mcpTool.toolCall);
    }

    results.push(entry);
  }
  return results;
}
