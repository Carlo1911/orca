import {
  getAgentForkArgv,
  getAgentResumeArgv,
  type AgentProviderSessionMetadata,
  type ResumableTuiAgent
} from './agent-session-resume'
import type { SessionOptionValue } from './native-chat-session-options'
import { buildSleepingAgentLaunchConfig } from './sleeping-agent-launch-config'
import type { SleepingAgentLaunchConfig } from './agent-session-resume'
import { resolveAgentLaunchCommand } from './tui-agent-launch-command'
import type { AgentStartupPlan } from './tui-agent-startup'
import { resolveStartupShell, type AgentStartupShell } from './tui-agent-startup-shell'
import { TUI_AGENT_CONFIG } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'
import { buildAgentResumeLaunchCommand } from './agent-resume-launch-command'

export function buildAgentResumeStartupPlan(args: {
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
  cmdOverrides: Partial<Record<TuiAgent, string>>
  platform: NodeJS.Platform
  shell?: AgentStartupShell
  agentArgs?: string | null
  agentEnv?: Record<string, string> | null
  agentCommand?: string | null
  ompResumeFilePath?: string | null
  sessionOptions?: Record<string, SessionOptionValue>
  sessionOptionsOverrideAgentArgs?: boolean
  isRemote?: boolean
  /** The caller chose the terminal folder on purpose, so Codex must not ask for the recorded one. */
  resumeInLaunchCwd?: boolean
  /** Open a copy of the conversation instead of re-entering it; null for agents that cannot. */
  fork?: boolean
  /**
   * Pinned launch recipe fixed at admission (KTD3). When present it replaces the
   * live `agentCommand`/`agentArgs`/`agentEnv` inputs above, so editing the
   * definition or defaults never changes a prior session's root, flags or account.
   */
  profileRecipe?: SleepingAgentLaunchConfig
  /**
   * Base provider of the pinned profile, or null for a generic CLI. A generic
   * has no native resume (KTD8): the caller restarts its command instead, so a
   * null here refuses the plan before any spawn.
   */
  profileBaseProvider?: string | null
}): AgentStartupPlan | null {
  // KTD8: a generic profile has no native resume; the caller restarts its command.
  if (args.profileBaseProvider === null) {
    return null
  }
  const resumeArgv = args.fork
    ? getAgentForkArgv(args.agent, args.providerSession)
    : getAgentResumeArgv(args.agent, args.providerSession, args.ompResumeFilePath)
  if (!resumeArgv) {
    return null
  }
  // Why: Codex otherwise prompts for the folder, defaulting to the recorded one even once it was
  // deleted (#17745). Kept before `resume` so dropAgentResumeArgvFromCommand strips only that.
  const argv =
    args.agent === 'codex' && args.resumeInLaunchCwd
      ? [resumeArgv[0], '-c', 'tui.resume_cwd=current', ...resumeArgv.slice(1)]
      : resumeArgv
  const shell = resolveStartupShell(args.platform, args.shell)
  // KTD3: the pinned recipe replaces live command/args/env inputs above it.
  const pinned = args.profileRecipe
  const resolvedAgentCommand = (pinned?.agentCommand ?? args.agentCommand)?.trim()
  const baseCommand = resolvedAgentCommand
    ? ({
        ok: true,
        command: resolvedAgentCommand,
        commandWithoutSessionOptions: resolvedAgentCommand,
        appliedSessionOptions: {}
      } as const)
    : resolveAgentLaunchCommand({
        agent: args.agent,
        cmdOverrides: args.cmdOverrides,
        platform: args.platform,
        shell,
        agentArgs: pinned?.agentArgs ?? args.agentArgs,
        sessionOptions: pinned ? undefined : args.sessionOptions,
        sessionOptionsOverrideAgentArgs: pinned ? undefined : args.sessionOptionsOverrideAgentArgs,
        isRemote: args.isRemote
      })
  if (!baseCommand.ok) {
    return null
  }
  const launchConfig = buildSleepingAgentLaunchConfig({
    ...args,
    agentCommand: baseCommand.commandWithoutSessionOptions
  })
  const launchCommand = buildAgentResumeLaunchCommand(args.agent, baseCommand.command, argv, shell)
  const applied = baseCommand.appliedSessionOptions
  const pinnedEnv = pinned?.agentEnv
  return {
    agent: args.agent,
    launchCommand,
    expectedProcess: TUI_AGENT_CONFIG[args.agent].expectedProcess,
    followupPrompt: null,
    launchConfig,
    ...(args.agent === 'codex' ? { startupCommandDelivery: 'shell-ready' as const } : {}),
    ...(Object.keys(applied).length > 0 ? { sessionOptions: { ...applied } } : {}),
    ...(pinnedEnv ? { env: { ...pinnedEnv } } : args.agentEnv ? { env: { ...args.agentEnv } } : {})
  }
}
