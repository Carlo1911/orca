import { isTuiAgent } from '../../../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../../../shared/tui-agent'
import { parseProfileSelector } from '../../../../../../shared/agent-launch-profile'
import { resolveProfileForLaunch } from '../../agent-launch-profile-resolution'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { FederationAttachStartInput } from '../federation/federation-start-schema'
import {
  assertWorkerLaunchPreferencesCreateTerminal,
  createWorkerLaunchReceipt,
  resolveWorkerLaunchPreferences
} from './worker-launch-preferences'
import type { WorkerStartInput } from './worker-start-schema'

type WorkerStartLaunch = ReturnType<typeof resolveWorkerLaunchPreferences>

type PreparedWorkerStart = {
  agent: TuiAgent | undefined
  launch: WorkerStartLaunch
  profileRecipe?: ResolvedWorkerProfile
}

export type ResolvedWorkerProfile = {
  profileId: string
  revisionId: string
  baseProvider: string | null
  command: string
  args: string
  envSet: Record<string, string>
  envUnset: string[]
  promptPolicy: 'argv' | 'flag' | 'stdin-after-start'
  promptFlag?: string
}

/**
 * Resolve a worker `--agent profile:<id>` against the host store (KTD2).
 * Derived profiles return their base agent + fixed recipe; generic profiles
 * are rejected — the decided worker mode cannot carry a generic recipe yet.
 */
export function resolveWorkerProfileAgent(
  runtime: OrcaRuntimeService,
  profileId: string
): { agent: TuiAgent; recipe: ResolvedWorkerProfile } {
  const settings = runtime.getClientAgentLaunchSettings()
  const resolved = resolveProfileForLaunch(profileId, {
    lookup: (id) => {
      const descriptor = (settings.agentProfiles as Record<string, unknown>)[id]
      if (!descriptor || typeof descriptor !== 'object') {
        return null
      }
      return { profile: descriptor as never, available: true }
    },
    definitions: new Map(),
    materialize: () => ({ ok: true })
  })
  if (!resolved.ok) {
    throw new OrchestrationError(
      'agent_unconfigured',
      `Unknown or unavailable profile: ${profileId}`
    )
  }
  if (resolved.recipe.baseProvider === null) {
    throw new OrchestrationError(
      'agent_unconfigured',
      'Generic profiles cannot start workers yet; use a derived profile.'
    )
  }
  const recipe = resolved.recipe
  return {
    agent: recipe.baseProvider as TuiAgent,
    recipe: {
      profileId: recipe.profileId,
      revisionId: recipe.revisionId,
      baseProvider: recipe.baseProvider,
      command: recipe.command,
      args: recipe.args,
      envSet: { ...recipe.envSet },
      envUnset: [...recipe.envUnset],
      promptPolicy: recipe.promptPolicy,
      ...(recipe.promptFlag !== undefined ? { promptFlag: recipe.promptFlag } : {})
    }
  }
}

export function validateFederatedWorkerStartPlacement(
  params: WorkerStartInput,
  createsWorktree: boolean
): void {
  if (createsWorktree && (!params.name || !params.repo)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Remote new-top-level requires --name and an explicit --repo from remote discovery.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with remote new-worktree creation.'
    )
  }
  if (!createsWorktree && (params.name || params.repo || params.baseBranch || params.setup)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to remote new-top-level worktrees.'
    )
  }
  if (params.terminal && params.agent) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal reuses an existing agent and cannot combine with --agent.'
    )
  }
  if (!params.terminal && !params.agent) {
    throw new OrchestrationError(
      'agent_unconfigured',
      'A configured --agent is required when remote worker-start creates a terminal.'
    )
  }
}

export function prepareLocalWorkerStart(args: {
  params: WorkerStartInput
  createsWorktree: boolean
  runtime: OrcaRuntimeService
  openCodeModelLaunchSupported?: boolean
}): PreparedWorkerStart {
  const { params, createsWorktree, runtime } = args
  assertWorkerLaunchPreferencesCreateTerminal(params)
  if (params.terminal && params.agent) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal reuses an existing agent and cannot combine with --agent.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with new-worktree creation.'
    )
  }
  if (createsWorktree && !params.name) {
    throw new OrchestrationError('invalid_argument', 'New worktrees require --name.')
  }
  if (!createsWorktree && (params.name || params.repo || params.baseBranch || params.setup)) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to new-child or new-top-level worktrees.'
    )
  }
  return resolveWorkerStartAgent({
    runtime,
    openCodeModelLaunchSupported: args.openCodeModelLaunchSupported,
    createsWorktree,
    terminal: params.terminal,
    agent: params.agent,
    model: params.model,
    effort: params.effort,
    missingAgentMessage: 'A configured --agent is required when worker-start creates a terminal.'
  })
}

export function prepareFederationAttachmentWorkerStart(args: {
  params: FederationAttachStartInput
  createsWorktree: boolean
  runtime: OrcaRuntimeService
  openCodeModelLaunchSupported?: boolean
}): PreparedWorkerStart {
  const { params, createsWorktree, runtime } = args
  assertWorkerLaunchPreferencesCreateTerminal(params)
  if (createsWorktree && (!params.name || !params.repo)) {
    throw new OrchestrationError(
      'invalid_argument',
      'A remote new-top-level worktree requires --name and an explicit --repo.'
    )
  }
  if (createsWorktree && params.terminal) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal cannot combine with remote new-worktree creation.'
    )
  }
  if (
    !createsWorktree &&
    (params.name || params.repo || params.baseBranch || params.setup || params.setupSource)
  ) {
    throw new OrchestrationError(
      'invalid_argument',
      'Creation and setup options apply only to remote new-top-level worktrees.'
    )
  }
  if (params.terminal && params.agent) {
    throw new OrchestrationError(
      'invalid_argument',
      '--terminal reuses an existing agent and cannot combine with --agent.'
    )
  }
  return resolveWorkerStartAgent({
    runtime,
    openCodeModelLaunchSupported: args.openCodeModelLaunchSupported,
    createsWorktree,
    terminal: params.terminal,
    agent: params.agent,
    model: params.model,
    effort: params.effort,
    missingAgentMessage:
      'A configured --agent is required when federated worker-start creates a terminal.'
  })
}

function resolveWorkerStartAgent(args: {
  runtime: OrcaRuntimeService
  openCodeModelLaunchSupported?: boolean
  createsWorktree: boolean
  terminal?: string
  agent?: string
  model?: string
  effort?: string
  missingAgentMessage: string
}): PreparedWorkerStart {
  const profileId = args.agent ? parseProfileSelector(args.agent) : null
  if (profileId !== null) {
    const resolved = resolveWorkerProfileAgent(args.runtime, profileId)
    if (args.model ?? args.effort) {
      throw new OrchestrationError(
        'invalid_argument',
        'Profiles carry their own model configuration; omit --model and --effort.'
      )
    }
    return {
      agent: resolved.agent,
      launch: resolveWorkerLaunchPreferences({
        agent: resolved.agent,
        openCodeModelLaunchSupported: args.openCodeModelLaunchSupported,
        createsWorktree: args.createsWorktree,
        model: undefined,
        effort: undefined
      }),
      profileRecipe: resolved.recipe
    }
  }
  const agent = args.agent
    ? isTuiAgent(args.agent)
      ? args.agent
      : args.runtime.resolveOrchestrationAgentLauncher?.(args.agent)
    : undefined
  if (!args.terminal && !agent) {
    throw new OrchestrationError('agent_unconfigured', args.missingAgentMessage)
  }
  if (agent) {
    args.runtime.validateOrchestrationAgentLauncher(agent)
    return {
      agent,
      launch: resolveWorkerLaunchPreferences({
        agent,
        openCodeModelLaunchSupported: args.openCodeModelLaunchSupported,
        createsWorktree: args.createsWorktree,
        model: args.model,
        effort: args.effort
      })
    }
  }
  return {
    agent: undefined,
    launch: {
      preferences: undefined,
      receipt: createWorkerLaunchReceipt({ agent: null })
    }
  }
}
