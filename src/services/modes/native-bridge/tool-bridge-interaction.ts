import { RunCommandAction } from '../../../core/windsurf.js';
import { WindsurfClient } from '../../../core/client.js';
import { BashToolResultInput, ToolBridgeSubmissionResult } from '../../../types.js';
import { patchToolBridgeSession, getToolBridgeSession } from './tool-bridge-store.js';
import { buildEchoCommand } from './tool-bridge-runtime.js';

export async function submitBashToolResultViaInteraction(args: {
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
      bridgePath: 'interaction',
      modeTried: 'interaction',
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
      bridgePath: 'interaction',
      modeTried: 'interaction',
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
      bridgePath: 'interaction',
      modeTried: 'interaction',
      advanced: false,
      observation: { status: null, newStepKinds: [], newToolNames: [], stepCount: session.proposalStepCount },
      text: '',
      thinking: '',
      error: 'toolCallId does not match the stored proposal',
    };
  }

  if (session.interactionResolved) {
    return {
      bridgeId: session.id,
      accepted: false,
      bridgePath: 'interaction',
      modeTried: 'interaction',
      advanced: false,
      observation: { status: null, newStepKinds: [], newToolNames: [], stepCount: session.proposalStepCount },
      text: '',
      thinking: '',
      error: 'run_command interaction has already been resolved',
    };
  }

  const stdout = String(args.payload.stdout || '');
  const stderr = String(args.payload.stderr || '');
  const exitCode = args.payload.exitCode ?? (args.payload.success === false ? 1 : 0);
  const submittedCommandLine = buildEchoCommand(stdout, stderr, exitCode);
  const client = new WindsurfClient(
    session.upstreamApiKey,
    args.port,
    args.csrfToken,
    session.sessionId,
  );

  patchToolBridgeSession(session.id, {
    status: 'replaying',
    interactionResolved: true,
    lastBridgePath: 'interaction',
    lastReplayError: '',
    lastReplayMode: null,
  });

  try {
    await client.submitRunCommandResult({
      cascadeId: session.cascadeId,
      trajectoryId: session.trajectoryId,
      stepIndex: session.proposalStepIndex,
      proposedCommand: session.proposedCommandLine,
      submittedCommandLine,
      action: RunCommandAction.CONFIRM,
    });

    const continuation = await args.collectContinuation(
      client,
      session.cascadeId,
      session.proposalStepCount,
    );
    const nextTrajectoryId = client.getSessionInfo().trajectoryId;

    patchToolBridgeSession(session.id, {
      status: continuation.advanced ? 'completed' : 'failed',
      trajectoryId: nextTrajectoryId || session.trajectoryId,
      lastReplayError: continuation.advanced ? '' : 'HandleCascadeUserInteraction did not advance the live cascade',
    });

    return {
      bridgeId: session.id,
      accepted: continuation.advanced,
      bridgePath: 'interaction',
      modeTried: 'interaction',
      advanced: continuation.advanced,
      observation: continuation.observation,
      text: continuation.text,
      thinking: continuation.thinking,
      submittedCommandLine,
      error: continuation.advanced ? undefined : 'HandleCascadeUserInteraction did not advance the live cascade',
    };
  } catch (error: any) {
    patchToolBridgeSession(session.id, {
      status: 'failed',
      lastReplayError: error.message,
    });
    return {
      bridgeId: session.id,
      accepted: false,
      bridgePath: 'interaction',
      modeTried: 'interaction',
      advanced: false,
      observation: { status: null, newStepKinds: [], newToolNames: [], stepCount: session.proposalStepCount },
      text: '',
      thinking: '',
      submittedCommandLine,
      error: error.message,
    };
  }
}
