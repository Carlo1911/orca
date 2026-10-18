import { computeAgentLaunchFingerprint } from '../../../../shared/agent-launch-operation'
import type { AgentLaunchIntent, AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import { agentSessionOperationKey } from '../../../../shared/agent-session-operation-ledger'
import { executeAgentLaunch } from '../../../agent-launch/agent-launch-executor'
import {
  trackTerminalSpawnDispatch,
  type TerminalSpawnDispatch
} from '../../../agent-launch/agent-launch-not-started'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcContext } from '../core'
import { admitAgentLaunchOperation, agentLaunchOperationCallerKey } from './agent-launch-replay'
import {
  AgentLaunchExecutionError,
  agentLaunchRefusalError,
  settleLaunchWhoseTabWasClosed,
  settleQuietly,
  withEarlyTab
} from './agent-launch-execution-outcome'
import type { AgentLaunchParams } from '../../../../shared/rpc-contract/agent-launch-params'
import {
  agentLaunchFailureCode,
  launchFailureWithoutEffectsCode
} from './agent-launch-failure-code'
import { publishEarlyTab, type AgentLaunchView } from './agent-launch-tab-publication'
import { resolveUnlaunchedIntent } from './agent-launch-intent-resolution'
import { agentLaunchSurfaceFactory } from './agent-launch-surfaces'
import { agentLaunchWorkspaceFactory } from './agent-launch-worktree-creation'
import {
  agentLaunchCallerNavigationId,
  selectAgentLaunchTabForCaller
} from './agent-launch-caller-selection'
import { withPlacement } from './agent-launch-tab-publication'
import { clientRendersStructuredAgent } from './structured-agent-session-policy'

/** What a launch admitted under an operation id carries into its execution. */
export type ReplaySafeLaunch = {
  attachOperationId: string
  callerKey: string
  terminalSpawn: TerminalSpawnDispatch
  /** Records the surface the moment it exists, an owed prompt as `unconfirmed`. Fired, never
   *  awaited: the ledger's transactions run in order, so the final settle still lands after it, and
   *  the prompt never waits on bookkeeping. */
  recordSurface: (provisional: AgentLaunchResult) => void
}

function callerRendersLaunchedChat(
  context: Pick<RpcContext, 'clientKind' | 'clientCapabilities'>,
  agent: string
): boolean {
  return (
    context.clientKind === undefined ||
    agent === 'claude' ||
    agent === 'codex' ||
    clientRendersStructuredAgent(context.clientCapabilities, agent)
  )
}

async function runAgentLaunch(
  intent: AgentLaunchIntent,
  context: RpcContext,
  view: AgentLaunchView,
  replaySafe?: ReplaySafeLaunch
): Promise<AgentLaunchResult> {
  const callerNavigationId = agentLaunchCallerNavigationId(intent.target, context)
  const result = await executeAgentLaunch({
    runtime: context.runtime,
    intent,
    surfaces: agentLaunchSurfaceFactory(
      context,
      replaySafe?.attachOperationId,
      replaySafe?.callerKey,
      callerNavigationId !== null,
      replaySafe?.terminalSpawn,
      view
    ),
    workspaces: agentLaunchWorkspaceFactory(context, intent.agent),
    ...(callerRendersLaunchedChat(context, intent.agent) ? {} : { callerRendersStructured: false }),
    onSurfacePublished: (surface) => {
      view.early?.surfacePublished(surface)
      replaySafe?.recordSurface(withPlacement(surface, view))
      if (callerNavigationId !== null && view.presentation !== 'background') {
        selectAgentLaunchTabForCaller(context.runtime, surface, callerNavigationId)
      }
    }
  })
  return withPlacement(result, view)
}

export function runLegacyAgentLaunch(
  params: AgentLaunchParams,
  context: RpcContext
): Promise<AgentLaunchResult> {
  const execute = async () =>
    runAgentLaunch(await resolveUnlaunchedIntent(params, context.runtime, null), context, {
      early: null,
      presentation: params.presentation
    })
  if (params.target.kind === 'create-worktree' && params.target.create.clientMutationId) {
    return context.runtime.dedupeWorktreeCreate(
      params.target.create.repo,
      `agent.launch:${params.target.create.clientMutationId}`,
      execute
    )
  }
  return execute()
}

type ActiveAgentLaunch = {
  fingerprint: string
  promise: Promise<AgentLaunchResult>
}

const activeAgentLaunchesByRuntime = new WeakMap<
  OrcaRuntimeService,
  Map<string, ActiveAgentLaunch>
>()

function activeAgentLaunchesFor(runtime: OrcaRuntimeService): Map<string, ActiveAgentLaunch> {
  let active = activeAgentLaunchesByRuntime.get(runtime)
  if (!active) {
    active = new Map()
    activeAgentLaunchesByRuntime.set(runtime, active)
  }
  return active
}

async function executeReplaySafeAgentLaunch(
  params: AgentLaunchParams & { operationId: string },
  context: RpcContext,
  fingerprint: string
): Promise<AgentLaunchResult> {
  const early = await publishEarlyTab(params, context)
  let admission: Awaited<ReturnType<typeof admitAgentLaunchOperation>>
  try {
    admission = await admitAgentLaunchOperation(context, params, fingerprint, Date.now())
  } catch (error) {
    early?.finish()
    throw error
  }
  if (admission.decision !== 'execute') {
    early?.finish(
      admission.decision === 'refuse' &&
        admission.refusal.code !== 'agent_session_operation_unknown'
        ? admission.refusal.code
        : undefined
    )
    if (admission.decision === 'refuse') {
      throw agentLaunchRefusalError(admission.refusal)
    }
    return admission.result
  }
  early?.executing()
  return withEarlyTab(early, () =>
    executeAdmittedAgentLaunch(params, context, admission, {
      early,
      presentation: params.presentation
    })
  )
}

async function executeAdmittedAgentLaunch(
  params: AgentLaunchParams & { operationId: string },
  context: RpcContext,
  admission: Extract<
    Awaited<ReturnType<typeof admitAgentLaunchOperation>>,
    { decision: 'execute' }
  >,
  view: AgentLaunchView
): Promise<AgentLaunchResult> {
  let intent: AgentLaunchIntent
  try {
    intent = await resolveUnlaunchedIntent(params, context.runtime, view.early)
  } catch (error) {
    await settleQuietly(admission.fail(agentLaunchFailureCode(error)))
    throw error
  }
  const terminalSpawn = trackTerminalSpawnDispatch()
  let result: AgentLaunchResult
  try {
    result = await runAgentLaunch(intent, context, view, {
      attachOperationId: admission.attachOperationId,
      callerKey: admission.callerKey,
      terminalSpawn,
      recordSurface: (provisional) => void settleQuietly(admission.record(provisional))
    })
  } catch (error) {
    if (view.early?.closedByUser()) {
      await settleLaunchWhoseTabWasClosed(context, view.early, admission)
    }
    const failedWithoutEffects = launchFailureWithoutEffectsCode(
      error,
      intent.target.kind,
      terminalSpawn
    )
    if (failedWithoutEffects) {
      await settleQuietly(admission.fail(failedWithoutEffects, error))
    }
    throw new AgentLaunchExecutionError(error, failedWithoutEffects)
  }
  if (view.early?.closedByUser()) {
    await settleLaunchWhoseTabWasClosed(context, view.early, admission)
  }
  await settleQuietly(admission.settle(result))
  return result
}

export function runReplaySafeAgentLaunch(
  params: AgentLaunchParams & { operationId: string },
  context: RpcContext
): Promise<AgentLaunchResult> {
  const callerKey = agentLaunchOperationCallerKey(context)
  const key = agentSessionOperationKey(callerKey, params.operationId)
  const fingerprint = computeAgentLaunchFingerprint(params)
  const activeAgentLaunches = activeAgentLaunchesFor(context.runtime)
  const active = activeAgentLaunches.get(key)
  if (active) {
    if (active.fingerprint !== fingerprint) {
      return Promise.reject(new Error('agent_session_operation_conflict'))
    }
    return active.promise
  }
  let promise: Promise<AgentLaunchResult>
  promise = executeReplaySafeAgentLaunch(params, context, fingerprint).finally(() => {
    if (activeAgentLaunches.get(key)?.promise === promise) {
      activeAgentLaunches.delete(key)
    }
  })
  activeAgentLaunches.set(key, { fingerprint, promise })
  return promise
}
