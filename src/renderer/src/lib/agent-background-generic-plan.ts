import { buildGenericAgentStartupPlan } from '../../../shared/generic-agent-startup'
import type { AgentLaunchIntent } from '../../../shared/agent-launch-intent'
import type { TuiAgent } from '../../../shared/tui-agent'

/**
 * KTD8: generic profiles run the fixed recipe verbatim — fixed command plus
 * env, no catalog lookup, no hooks, no structured session. Returns null when
 * there is no profile recipe (caller falls back to the catalog plan) or the
 * recipe builds no command.
 */
export function buildGenericBackgroundStartupPlan(args: {
  agent: TuiAgent
  profileRecipe: NonNullable<AgentLaunchIntent['profileRecipe']> | null
  prompt: string
  launchPlatform: NodeJS.Platform
  hasPrompt: boolean
  isFollowupPath: boolean
}): {
  plan: {
    agent: TuiAgent
    launchCommand: string
    expectedProcess: string
    followupPrompt: string | null
    env: Record<string, string>
    launchConfig: { agentCommand: string; agentArgs: string; agentEnv: Record<string, string> }
    startupCommandDelivery: undefined
    sessionOptions: undefined
  } | null
  followup: string | null
} {
  const { agent, profileRecipe, prompt, launchPlatform, hasPrompt, isFollowupPath } = args
  if (!profileRecipe) {
    return { plan: null, followup: null }
  }
  const genericPlan = buildGenericAgentStartupPlan({
    profile: {
      command: profileRecipe.command,
      args: profileRecipe.args,
      envSet: { ...profileRecipe.envSet },
      promptPolicy: profileRecipe.promptPolicy,
      ...(profileRecipe.promptFlag !== undefined ? { promptFlag: profileRecipe.promptFlag } : {})
    },
    prompt,
    platform: launchPlatform
  })
  if (!genericPlan) {
    return { plan: null, followup: null }
  }
  const planEnv: Record<string, string> = genericPlan.env ?? {}
  const followup =
    genericPlan.followupPrompt ?? (hasPrompt && isFollowupPath ? prompt.trim() : null)
  return {
    plan: {
      agent,
      launchCommand: genericPlan.launchCommand,
      expectedProcess: genericPlan.expectedProcess,
      followupPrompt: genericPlan.followupPrompt,
      env: planEnv,
      launchConfig: {
        agentCommand: genericPlan.launchCommand,
        agentArgs: '',
        agentEnv: { ...planEnv }
      },
      startupCommandDelivery: undefined,
      sessionOptions: undefined
    },
    followup: followup && followup.length > 0 ? followup : null
  }
}
