import { describe, expect, it } from 'vitest'
import { AgentProfileDescriptor } from '../../../../shared/agent-launch-profile'
import { resolveProfileForLaunch } from './agent-launch-profile-resolution'

function profile(id: string, overrides: Record<string, unknown> = {}) {
  return AgentProfileDescriptor.parse({
    id,
    label: id,
    ownerHostId: 'host-1',
    baseProvider: 'claude',
    enabled: true,
    revisionId: 'rev-1',
    command: 'claude',
    args: '',
    envSet: { CLAUDE_CONFIG_DIR: '/work/.claude' },
    envUnset: [],
    promptPolicy: 'argv',
    ...overrides
  })
}

function depsFor(defs: ReturnType<typeof profile>[], available = true) {
  const definitions = new Map(defs.map((definition) => [definition.id, definition]))
  return {
    lookup: (id: string) => {
      const found = definitions.get(id)
      return found ? { profile: found, available } : null
    },
    definitions,
    materialize: () => ({ ok: true as const })
  }
}

describe('resolveProfileForLaunch', () => {
  it('fixes the recipe from the mutable definition', () => {
    const result = resolveProfileForLaunch('work', depsFor([profile('work')]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.recipe.profileId).toBe('work')
      expect(result.recipe.revisionId).toBe('rev-1')
      expect(result.recipe.envSet).toEqual({ CLAUDE_CONFIG_DIR: '/work/.claude' })
    }
  })

  it('rejects unknown, disabled, and unavailable profiles with distinct codes', () => {
    expect(resolveProfileForLaunch('missing', depsFor([]))).toEqual({
      ok: false,
      code: 'agent_launch_unknown_profile'
    })
    expect(resolveProfileForLaunch('off', depsFor([profile('off', { enabled: false })]))).toEqual({
      ok: false,
      code: 'agent_launch_profile_disabled'
    })
    expect(resolveProfileForLaunch('down', depsFor([profile('down')], false))).toEqual({
      ok: false,
      code: 'agent_launch_profile_unavailable'
    })
  })

  it('rejects when the sealed payload cannot materialize', () => {
    const deps = {
      ...depsFor([profile('work')]),
      materialize: () => ({ ok: false as const, reason: 'key-missing' })
    }
    expect(resolveProfileForLaunch('work', deps)).toEqual({
      ok: false,
      code: 'agent_launch_profile_unavailable'
    })
  })
})
