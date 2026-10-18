import {
  resolveAgentLaunchTarget,
  type ProfileLookup
} from '../../../../shared/agent-launch-profile-resolution'
import { AGENT_LAUNCH_PROFILES_RUNTIME_CAPABILITY } from '../../../../shared/agent-launch-runtime-capability'
import type { AgentLaunchIntent } from '../../../../shared/agent-launch-intent'
import type { AgentProfileDescriptor } from '../../../../shared/agent-launch-profile'
import type { RpcContext } from '../core'

/**
 * KTD6: a profiled launch needs explicit host support. Reject before any
 * effect — never fall back to another profile, the base provider, or Auto.
 * In-process callers negotiate nothing, like the launch capability itself.
 */
export function assertProfileLaunchSupported(
  params: { profileId?: string },
  context: Pick<RpcContext, 'clientKind' | 'clientCapabilities'>
): void {
  if (params.profileId === undefined || context.clientKind === undefined) {
    return
  }
  const announces =
    context.clientCapabilities?.includes(AGENT_LAUNCH_PROFILES_RUNTIME_CAPABILITY) === true
  if (!announces) {
    throw new Error('agent_launch_profile_unsupported')
  }
}

export type ProfileResolverDeps = {
  lookup: ProfileLookup
  /** Full descriptors from the host store (never the paired projection). */
  definitions: Map<string, AgentProfileDescriptor>
  /** Sealed payload materializer for the target process. */
  materialize: (profileId: string) => { ok: true } | { ok: false; reason: string }
}

/**
 * Resolve `profileId` before admission (KTD2/KTD6): unknown, disabled, or
 * unavailable profiles reject before effects — never fall back to another
 * profile, the base provider, or Auto. On success, fix the recipe on the
 * intent (KTD3); the executor runs it, never the mutable definition.
 */
export function resolveProfileForLaunch(
  profileId: string,
  deps: ProfileResolverDeps
):
  | { ok: true; recipe: NonNullable<AgentLaunchIntent['profileRecipe']> }
  | { ok: false; code: string } {
  const resolved = resolveAgentLaunchTarget({ kind: 'profile', profileId }, deps.lookup)
  if (!resolved.ok) {
    return {
      ok: false,
      code:
        resolved.reason === 'profile-disabled'
          ? 'agent_launch_profile_disabled'
          : resolved.reason === 'profile-unavailable'
            ? 'agent_launch_profile_unavailable'
            : 'agent_launch_unknown_profile'
    }
  }
  if (resolved.kind !== 'derived' && resolved.kind !== 'generic') {
    return { ok: false, code: 'agent_launch_unknown_profile' }
  }
  const materialized = deps.materialize(resolved.profile.id)
  if (!materialized.ok) {
    return { ok: false, code: 'agent_launch_profile_unavailable' }
  }
  const recipe = resolved.profile
  return {
    ok: true,
    recipe: {
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
}
