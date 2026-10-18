import type { AgentLaunchTarget, AgentProfileDescriptor } from './agent-launch-profile'
import { isTuiAgent } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'

export type ProfileResolution =
  | { ok: true; kind: 'builtin'; agent: TuiAgent }
  | { ok: true; kind: 'derived'; agent: TuiAgent; profile: AgentProfileDescriptor }
  | { ok: true; kind: 'generic'; profile: AgentProfileDescriptor }
  | { ok: false; reason: 'unknown-profile' | 'profile-disabled' | 'profile-unavailable' }

export type ProfileLookup = (
  profileId: string
) => { profile: AgentProfileDescriptor; available: boolean } | null

/**
 * Resolve a launch target to its recipe. Deterministic for the same state;
 * never mutates definitions or defaults. A missing or disabled profile never
 * falls back to Auto or its base provider — the caller rejects before effects.
 */
export function resolveAgentLaunchTarget(
  target: AgentLaunchTarget,
  lookup: ProfileLookup
): ProfileResolution {
  if (target.kind === 'builtin') {
    return { ok: true, kind: 'builtin', agent: target.agent }
  }
  const found = lookup(target.profileId)
  if (!found) {
    return { ok: false, reason: 'unknown-profile' }
  }
  const { profile, available } = found
  if (!profile.enabled) {
    return { ok: false, reason: 'profile-disabled' }
  }
  if (!available) {
    return { ok: false, reason: 'profile-unavailable' }
  }
  if (profile.baseProvider !== null && isTuiAgent(profile.baseProvider)) {
    return { ok: true, kind: 'derived', agent: profile.baseProvider, profile }
  }
  return { ok: true, kind: 'generic', profile }
}

/**
 * Merge profile env over inherited launch env. Profile `envSet` wins; names
 * in `envUnset` are removed. Orca-reserved transport keys stay owned by the
 * runtime: the caller strips them after this merge, never before.
 */
export function applyProfileEnv(
  inherited: Record<string, string>,
  profile: Pick<AgentProfileDescriptor, 'envSet' | 'envUnset'>
): Record<string, string> {
  const merged: Record<string, string> = { ...inherited }
  for (const name of profile.envUnset) {
    delete merged[name]
  }
  for (const [name, value] of Object.entries(profile.envSet)) {
    merged[name] = value
  }
  return merged
}

export function applyProfileEnvForPlatform(
  inherited: Record<string, string>,
  profile: Pick<AgentProfileDescriptor, 'envSet' | 'envUnset'>,
  platform: NodeJS.Platform
): Record<string, string> {
  if (platform !== 'win32') {
    return applyProfileEnv(inherited, profile)
  }
  // `Path` unsets `PATH` and vice versa. Profile `envSet` casing wins.
  const merged = new Map<string, { name: string; value: string }>()
  for (const [name, value] of Object.entries(inherited)) {
    merged.set(name.toLowerCase(), { name, value })
  }
  for (const name of profile.envUnset) {
    merged.delete(name.toLowerCase())
  }
  for (const [name, value] of Object.entries(profile.envSet)) {
    merged.set(name.toLowerCase(), { name, value })
  }
  return Object.fromEntries([...merged.values()].map(({ name, value }) => [name, value]))
}
