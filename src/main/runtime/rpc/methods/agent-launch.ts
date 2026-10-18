/**
 * `agent.launch` — the one method that starts an agent, whatever surface it turns out to be.
 *
 * It exists because the routing decision had no host-side home: `worktree.create` never consulted
 * it, so any client that created a worktree with `startupAgent` got a PTY agent no matter what the
 * user's default said. That is not fixable inside `worktree.create`, because its contract is
 * exactly "spawn a PTY agent and hand me its `agentTerminalHandle`" — a host that quietly answered
 * it with a structured session would hand every older client a response with no handle and no
 * error. So `worktree.create` keeps that meaning verbatim, forever, and everything that has to
 * choose a surface comes here instead, behind a negotiated capability.
 *
 * A caller therefore never asks for a mode, and must read `outcome.kind` rather than assume one:
 * the receipt always says which surface ran and why, so a downgrade is never silent.
 *
 * A launch is also the one call whose retry is most expensive to get wrong — a lost reply means the
 * caller cannot tell "never ran" from "ran, answer lost" — so a caller may name the operation with
 * `operationId` and get exactly one execution, a recorded answer on every replay, and a refusal
 * when the outcome is genuinely unknown. That guarantee is safety, not recovery: it makes a retry
 * harmless, and does nothing to reunite a caller with a surface a dead attempt left behind.
 */

import { AGENT_LAUNCH_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import { AgentLaunchTabClosedError } from '../../../../shared/agent-launch-tab-closed'
import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import {
  WorktreeCreateCollisionError,
  WORKTREE_CREATE_COLLISION_CODE
} from '../../../../shared/new-workspace/worktree-create-collision'
import { defineMethod, type RpcContext } from '../core'
import {
  AgentLaunchExecutionError,
  agentLaunchTabClosedAnswer
} from './agent-launch-execution-outcome'
import { AgentLaunch, AgentLaunchReplay } from '../../../../shared/rpc-contract/agent-launch-params'
import { assertAgentLaunchTargetAuthorized } from './agent-launch-target-authorization'
import { assertProfileLaunchSupported } from './agent-launch-profile-resolution'
import { runLegacyAgentLaunch, runReplaySafeAgentLaunch } from './agent-launch-runner'

export function supportsAgentLaunch(
  context: Pick<RpcContext, 'clientKind' | 'clientCapabilities'>
): boolean {
  return (
    context.clientKind === undefined ||
    context.clientCapabilities?.includes(AGENT_LAUNCH_RUNTIME_CAPABILITY) === true
  )
}

export const AGENT_LAUNCH_METHODS = [
  defineMethod({
    name: 'agent.launchReplay',
    permission: 'workspace',
    params: AgentLaunchReplay,
    handler: async (params, context): Promise<AgentLaunchResult> => {
      if (!supportsAgentLaunch(context)) {
        throw new Error('agent_launch_replay_unsupported')
      }
      assertAgentLaunchTargetAuthorized(params.target, context)
      try {
        return await runReplaySafeAgentLaunch(params, context)
      } catch (error) {
        if (error instanceof AgentLaunchExecutionError) {
          if (error.cause instanceof WorktreeCreateCollisionError) {
            throw Object.assign(new Error(error.cause.message, { cause: error.cause }), {
              code: WORKTREE_CREATE_COLLISION_CODE
            })
          }
          if (error.cause instanceof AgentLaunchTabClosedError) {
            throw agentLaunchTabClosedAnswer(context)
          }
          if (error.failedWithoutEffects) {
            throw error.cause
          }
          throw new Error('agent_session_operation_unknown', { cause: error.cause })
        }
        throw error
      }
    }
  }),
  defineMethod({
    name: 'agent.launch',
    permission: 'workspace',
    params: AgentLaunch,
    handler: async (params, context): Promise<AgentLaunchResult> => {
      if (!supportsAgentLaunch(context)) {
        throw new Error('agent_launch_unsupported')
      }
      assertProfileLaunchSupported(params, context)
      assertAgentLaunchTargetAuthorized(params.target, context)
      if (!params.operationId) {
        return runLegacyAgentLaunch(params, context)
      }
      return runReplaySafeAgentLaunch(
        {
          ...params,
          operationId: params.operationId
        },
        context
      ).catch((error: unknown) => {
        if (error instanceof AgentLaunchExecutionError) {
          throw error.cause instanceof AgentLaunchTabClosedError
            ? agentLaunchTabClosedAnswer(context)
            : error.cause
        }
        throw error
      })
    }
  })
]
