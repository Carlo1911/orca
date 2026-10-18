import type { AgentStartupPlan } from './tui-agent-startup'
import { resolveStartupShell } from './tui-agent-startup-shell'
import type { AgentProfileDescriptor } from './agent-launch-profile'

/**
 * Generic profile startup (KTD8): run the configured executable in a PTY with
 * the declared prompt delivery. No hooks, no structured session, no resume.
 * An outcome without evidence stays unknown/unsupported — never completed.
 */
export type GenericAgentStartupPlan = Pick<
  AgentStartupPlan,
  'launchCommand' | 'expectedProcess' | 'followupPrompt' | 'env'
> & {
  promptDelivery: 'argv' | 'flag' | 'stdin-after-start'
}

export function buildGenericAgentStartupPlan(args: {
  profile: Pick<
    AgentProfileDescriptor,
    'command' | 'args' | 'envSet' | 'promptPolicy' | 'promptFlag'
  >
  prompt: string
  platform: NodeJS.Platform
}): GenericAgentStartupPlan | null {
  const { profile, prompt, platform } = args
  const command = profile.command.trim()
  if (!command) {
    return null
  }
  const shell = resolveStartupShell(platform, undefined)
  void shell
  const trimmedPrompt = prompt.trim()
  const quoted = (value: string): string =>
    value === '' || /[\s"'\\$`]/.test(value) ? JSON.stringify(value) : value
  const base = [command, profile.args.trim()].filter(Boolean).join(' ')
  if (profile.promptPolicy === 'stdin-after-start') {
    return {
      launchCommand: base,
      expectedProcess: command.split(/\s+/)[0] ?? command,
      followupPrompt: trimmedPrompt || null,
      env: { ...profile.envSet },
      promptDelivery: 'stdin-after-start'
    }
  }
  if (profile.promptPolicy === 'flag') {
    const flag = (profile.promptFlag ?? '').trim() || '--prompt'
    const launchCommand = trimmedPrompt ? `${base} ${flag} ${quoted(trimmedPrompt)}` : base
    return {
      launchCommand,
      expectedProcess: command.split(/\s+/)[0] ?? command,
      followupPrompt: null,
      env: { ...profile.envSet },
      promptDelivery: 'flag'
    }
  }
  const launchCommand = trimmedPrompt ? `${base} ${quoted(trimmedPrompt)}` : base
  return {
    launchCommand,
    expectedProcess: command.split(/\s+/)[0] ?? command,
    followupPrompt: null,
    env: { ...profile.envSet },
    promptDelivery: 'argv'
  }
}
