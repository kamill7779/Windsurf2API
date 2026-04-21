import { WindsurfClient } from '../core/client.js';
import { grpcFrame, grpcUnary } from '../core/grpc.js';
import {
  buildGetTrajectoryRequest,
  buildReplayGroundTruthTrajectoryRequest,
  buildSendCascadeMessageRequestWithItems,
  parseTrajectoryStatus,
  PlannerMode,
} from '../core/windsurf.js';
import {
  writeMessageField,
  writeStringField,
  writeVarintField,
} from '../core/proto.js';
import { BashToolResultInput, ToolBridgeSubmissionResult } from '../types.js';
import { patchToolBridgeSession, getToolBridgeSession } from './tool-bridge-store.js';
import { buildCombinedOutput, safeParseJson } from './tool-bridge-runtime.js';

const LS_SERVICE = '/exa.language_server_pb.LanguageServerService';

function buildRunCommandPayload(session: NonNullable<ReturnType<typeof getToolBridgeSession>>, result: BashToolResultInput): Buffer {
  const parsedArgs = safeParseJson(session.proposalArgumentsJson);
  const command =
    String(parsedArgs.command || parsedArgs.commandLine || parsedArgs.command_line || '');
  const cwd = String(parsedArgs.cwd || parsedArgs.workdir || parsedArgs.working_directory || '');
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const combinedOutput = buildCombinedOutput(stdout, stderr);
  const exitCode = result.exitCode ?? (result.success === false ? 1 : 0);

  const nestedCombined = combinedOutput
    ? writeMessageField(21, writeStringField(1, combinedOutput))
    : Buffer.alloc(0);

  return Buffer.concat([
    writeStringField(2, cwd),
    writeStringField(4, stdout),
    writeStringField(5, stderr),
    writeVarintField(6, exitCode),
    writeStringField(13, session.proposalToolCallId),
    nestedCombined,
    writeStringField(23, command),
    writeStringField(25, command),
    writeStringField(27, 'bash'),
  ]);
}

function buildCommandStatusPayload(session: NonNullable<ReturnType<typeof getToolBridgeSession>>, result: BashToolResultInput): Buffer {
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const combinedOutput = buildCombinedOutput(stdout, stderr);
  const exitCode = result.exitCode ?? (result.success === false ? 1 : 0);
  const statusCode = exitCode === 0 ? 2 : 3;

  return Buffer.concat([
    writeStringField(1, session.proposalToolCallId),
    writeVarintField(2, statusCode),
    writeStringField(3, stdout),
    writeStringField(4, stderr),
    writeVarintField(5, exitCode),
    writeStringField(9, combinedOutput),
    writeStringField(12, combinedOutput),
  ]);
}

function buildExperimentalRunCommandStep(session: NonNullable<ReturnType<typeof getToolBridgeSession>>, result: BashToolResultInput): Buffer {
  return Buffer.concat([
    writeVarintField(1, 8),
    writeVarintField(4, 2),
    writeMessageField(28, buildRunCommandPayload(session, result)),
  ]);
}

function buildExperimentalCommandStatusStep(session: NonNullable<ReturnType<typeof getToolBridgeSession>>, result: BashToolResultInput): Buffer {
  return Buffer.concat([
    writeVarintField(1, 8),
    writeVarintField(4, 2),
    writeMessageField(37, buildCommandStatusPayload(session, result)),
  ]);
}

async function unary(
  port: number,
  csrfToken: string,
  path: string,
  payload: Buffer,
  timeout = 30_000,
): Promise<Buffer> {
  return grpcUnary(port, csrfToken, `${LS_SERVICE}/${path}`, grpcFrame(payload), timeout);
}

async function getCascadeStatus(
  session: NonNullable<ReturnType<typeof getToolBridgeSession>>,
  port: number,
  csrfToken: string,
): Promise<number | null> {
  const trajectoryResp = await unary(
    port,
    csrfToken,
    'GetCascadeTrajectory',
    buildGetTrajectoryRequest(session.cascadeId),
    10_000,
  );
  return parseTrajectoryStatus(trajectoryResp);
}

async function ensureCascadeIdle(
  session: NonNullable<ReturnType<typeof getToolBridgeSession>>,
  port: number,
  csrfToken: string,
): Promise<number | null> {
  const initialStatus = await getCascadeStatus(session, port, csrfToken);
  if (initialStatus === 1) {
    return initialStatus;
  }

  await unary(
    port,
    csrfToken,
    'CancelCascadeInvocationAndWait',
    writeStringField(1, session.cascadeId),
    30_000,
  );

  const deadline = Date.now() + 7_000;
  while (Date.now() < deadline) {
    const status = await getCascadeStatus(session, port, csrfToken);
    if (status === 1) {
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  return getCascadeStatus(session, port, csrfToken);
}

export async function submitBashToolResultViaLegacy(args: {
  payload: BashToolResultInput;
  port: number;
  csrfToken: string;
  collectContinuation: (client: WindsurfClient, cascadeId: string, stepOffset: number) => Promise<{
    advanced: boolean;
    text: string;
    thinking: string;
    observation: ToolBridgeSubmissionResult['observation'];
  }>;
}): Promise<ToolBridgeSubmissionResult> {
  const session = getToolBridgeSession(args.payload.bridgeId);
  if (!session) {
    return {
      bridgeId: args.payload.bridgeId,
      accepted: false,
      bridgePath: 'legacy_cancel',
      modeTried: null,
      advanced: false,
      observation: { status: null, newStepKinds: [], newToolNames: [], stepCount: 0 },
      text: '',
      thinking: '',
      error: 'Bridge session not found',
    };
  }

  if (session.mockToolName !== 'Bash') {
    return {
      bridgeId: session.id,
      accepted: false,
      bridgePath: 'legacy_cancel',
      modeTried: null,
      advanced: false,
      observation: { status: null, newStepKinds: [], newToolNames: [], stepCount: session.proposalStepCount },
      text: '',
      thinking: '',
      error: `Bridge session ${session.id} is for ${session.mockToolName}, not Bash`,
    };
  }

  if (args.payload.toolCallId !== session.proposalToolCallId) {
    return {
      bridgeId: session.id,
      accepted: false,
      bridgePath: 'legacy_cancel',
      modeTried: null,
      advanced: false,
      observation: { status: null, newStepKinds: [], newToolNames: [], stepCount: session.proposalStepCount },
      text: '',
      thinking: '',
      error: 'toolCallId does not match the stored proposal',
    };
  }

  patchToolBridgeSession(session.id, {
    status: 'replaying',
    lastBridgePath: 'legacy_cancel',
    lastReplayError: '',
  });

  const runStep = buildExperimentalRunCommandStep(session, args.payload);
  const commandStatusStep = buildExperimentalCommandStatusStep(session, args.payload);
  const client = new WindsurfClient(session.upstreamApiKey, args.port, args.csrfToken, session.sessionId);

  try {
    const idleStatus = await ensureCascadeIdle(session, args.port, args.csrfToken);
    if (idleStatus !== 1) {
      patchToolBridgeSession(session.id, {
        status: 'failed',
        lastReplayError: `cancel_before_replay: cascade did not become idle (status=${idleStatus})`,
      });
      return {
        bridgeId: session.id,
        accepted: false,
        bridgePath: 'legacy_cancel',
        modeTried: null,
        advanced: false,
        observation: {
          status: idleStatus,
          newStepKinds: [],
          newToolNames: [],
          stepCount: session.proposalStepCount,
        },
        text: '',
        thinking: '',
        error: `cascade did not become idle before replay (status=${idleStatus})`,
      };
    }

    const additionalRequest = buildSendCascadeMessageRequestWithItems(
      session.upstreamApiKey,
      session.cascadeId,
      [],
      session.modelEnum,
      session.modelUid,
      session.sessionId,
      { plannerMode: PlannerMode.DEFAULT },
      [runStep, commandStatusStep],
    );
    await unary(
      args.port,
      args.csrfToken,
      'SendUserCascadeMessage',
      additionalRequest,
      30_000,
    );

    const continuation = await args.collectContinuation(client, session.cascadeId, session.proposalStepCount);
    if (continuation.advanced) {
      patchToolBridgeSession(session.id, {
        status: 'completed',
        lastReplayMode: 'additional_steps',
        lastReplayError: '',
      });
      return {
        bridgeId: session.id,
        accepted: true,
        bridgePath: 'legacy_cancel',
        modeTried: 'additional_steps',
        advanced: true,
        observation: continuation.observation,
        text: continuation.text,
        thinking: continuation.thinking,
      };
    }
  } catch (error: any) {
    patchToolBridgeSession(session.id, {
      lastReplayError: `additional_steps: ${error.message}`,
      lastReplayMode: 'additional_steps',
    });
  }

  try {
    const proposalStep = Buffer.from(session.proposalStepBase64, 'base64');
    const replayRequest = buildReplayGroundTruthTrajectoryRequest(
      session.upstreamApiKey,
      session.cascadeId,
      [proposalStep, runStep, commandStatusStep],
      session.modelEnum,
      session.modelUid,
      session.sessionId,
      { plannerMode: PlannerMode.DEFAULT },
    );

    await unary(
      args.port,
      args.csrfToken,
      'ReplayGroundTruthTrajectory',
      replayRequest,
      60_000,
    );

    const continuation = await args.collectContinuation(client, session.cascadeId, session.proposalStepCount);
    patchToolBridgeSession(session.id, {
      status: continuation.advanced ? 'completed' : 'failed',
      lastReplayMode: 'replay_ground_truth',
      lastReplayError: continuation.advanced ? '' : 'ReplayGroundTruthTrajectory did not advance the live cascade',
    });
    return {
      bridgeId: session.id,
      accepted: continuation.advanced,
      bridgePath: 'legacy_cancel',
      modeTried: 'replay_ground_truth',
      advanced: continuation.advanced,
      observation: continuation.observation,
      text: continuation.text,
      thinking: continuation.thinking,
      error: continuation.advanced ? undefined : 'ReplayGroundTruthTrajectory did not advance the live cascade',
    };
  } catch (error: any) {
    patchToolBridgeSession(session.id, {
      status: 'failed',
      lastReplayMode: 'replay_ground_truth',
      lastReplayError: error.message,
    });
    return {
      bridgeId: session.id,
      accepted: false,
      bridgePath: 'legacy_cancel',
      modeTried: 'replay_ground_truth',
      advanced: false,
      observation: {
        status: null,
        newStepKinds: [],
        newToolNames: [],
        stepCount: session.proposalStepCount,
      },
      text: '',
      thinking: '',
      error: error.message,
    };
  }
}
