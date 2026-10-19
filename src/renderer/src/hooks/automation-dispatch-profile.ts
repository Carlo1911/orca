import { resolveAgentLaunchTarget } from '../../../shared/agent-launch-profile-resolution'
import { readHostAgentLaunchSettings } from '@/components/settings/agent-launch-settings-transport'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'

export type DispatchProfileRecipe = {
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
 * Resolve the automation's profile at claim time (KTD2). Returns the fixed
 * recipe, `undefined` when the automation names no profile, or `null` after
 * reporting an explicit failure (never a fallback target).
 */
export async function resolveDispatchProfileRecipe(args: {
  state: Parameters<typeof getRuntimeEnvironmentIdForWorktree>[0]
  worktreeId: string
  profileId?: string | null
  fail: (error: string) => Promise<unknown>
}): Promise<DispatchProfileRecipe | undefined | null> {
  const { state, worktreeId, profileId, fail } = args
  if (!profileId) {
    return undefined
  }
  const environmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  if (!environmentId) {
    await fail('agent_launch_profile_unavailable: unknown host')
    return null
  }
  const settings = await readHostAgentLaunchSettings({ environmentId }).catch(() => null)
  const resolved = resolveAgentLaunchTarget({ kind: 'profile', profileId }, (id) => {
    const descriptor = (settings?.agentProfiles as Record<string, unknown> | undefined)?.[id]
    if (!descriptor || typeof descriptor !== 'object') {
      return null
    }
    return { profile: descriptor as never, available: true }
  })
  if (!resolved.ok) {
    const code =
      resolved.reason === 'profile-disabled'
        ? 'agent_launch_profile_disabled'
        : resolved.reason === 'profile-unavailable'
          ? 'agent_launch_profile_unavailable'
          : 'agent_launch_unknown_profile'
    await fail(`agent_launch_profile_unavailable: ${code}`)
    return null
  }
  if (resolved.kind !== 'derived') {
    await fail('agent_launch_profile_unsupported: generic profiles need an interactive PTY here')
    return null
  }
  const recipe = resolved.profile
  return {
    profileId: recipe.id,
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
