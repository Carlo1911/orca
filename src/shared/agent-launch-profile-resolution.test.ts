import { describe, expect, it } from 'vitest'
import { AgentProfileDescriptor } from './agent-launch-profile'
import {
  applyProfileEnv,
  applyProfileEnvForPlatform,
  resolveAgentLaunchTarget
} from './agent-launch-profile-resolution'

function profile(overrides: Record<string, unknown> = {}) {
  return AgentProfileDescriptor.parse({
    id: 'p1',
    label: 'P1',
    ownerHostId: 'host-1',
    baseProvider: 'claude',
    enabled: true,
    revisionId: 'rev-1',
    command: 'claude',
    args: '',
    envSet: {},
    envUnset: [],
    promptPolicy: 'argv',
    ...overrides
  })
}

describe('resolveAgentLaunchTarget', () => {
  it('resolves a builtin without touching profiles', () => {
    const result = resolveAgentLaunchTarget({ kind: 'builtin', agent: 'codex' }, () => null)
    expect(result).toEqual({ ok: true, kind: 'builtin', agent: 'codex' })
  })

  it('resolves two profiles of the same provider to different recipes', () => {
    const personal = profile({ id: 'personal', envSet: { CLAUDE_CONFIG_DIR: '/home/.claude' } })
    const work = profile({ id: 'work', envSet: { CLAUDE_CONFIG_DIR: '/work/.claude' } })
    const lookup = (id: string) =>
      id === 'personal'
        ? { profile: personal, available: true }
        : id === 'work'
          ? { profile: work, available: true }
          : null
    const personalResult = resolveAgentLaunchTarget(
      { kind: 'profile', profileId: 'personal' },
      lookup
    )
    const workResult = resolveAgentLaunchTarget({ kind: 'profile', profileId: 'work' }, lookup)
    expect(personalResult).toMatchObject({ ok: true, kind: 'derived', agent: 'claude' })
    expect(workResult).toMatchObject({ ok: true, kind: 'derived', agent: 'claude' })
    if (
      personalResult.ok &&
      personalResult.kind === 'derived' &&
      workResult.ok &&
      workResult.kind === 'derived'
    ) {
      expect(personalResult.profile.envSet).not.toEqual(workResult.profile.envSet)
    }
  })

  it('resolves a generic profile without catalog permissions', () => {
    const generic = profile({ id: 'g1', baseProvider: null, promptPolicy: 'stdin-after-start' })
    const result = resolveAgentLaunchTarget({ kind: 'profile', profileId: 'g1' }, () => ({
      profile: generic,
      available: true
    }))
    expect(result).toEqual({ ok: true, kind: 'generic', profile: generic })
  })

  it('never falls back for unknown, disabled, or unavailable profiles', () => {
    const disabled = profile({ id: 'off', enabled: false })
    expect(resolveAgentLaunchTarget({ kind: 'profile', profileId: 'missing' }, () => null)).toEqual(
      { ok: false, reason: 'unknown-profile' }
    )
    expect(
      resolveAgentLaunchTarget({ kind: 'profile', profileId: 'off' }, () => ({
        profile: disabled,
        available: true
      }))
    ).toEqual({ ok: false, reason: 'profile-disabled' })
    expect(
      resolveAgentLaunchTarget({ kind: 'profile', profileId: 'off' }, () => ({
        profile: profile({ id: 'off' }),
        available: false
      }))
    ).toEqual({ ok: false, reason: 'profile-unavailable' })
  })
})

describe('applyProfileEnv', () => {
  it('lets profile set win and unset remove inherited names', () => {
    const merged = applyProfileEnv(
      { KEEP: '1', DROP: 'x', OVER: 'old' },
      { envSet: { OVER: 'new', ADDED: 'y' }, envUnset: ['DROP'] }
    )
    expect(merged).toEqual({ KEEP: '1', OVER: 'new', ADDED: 'y' })
  })

  it('keeps empty-string values distinct from unset', () => {
    const merged = applyProfileEnv({ A: 'x' }, { envSet: { EMPTY: '' }, envUnset: [] })
    expect(merged.EMPTY).toBe('')
  })

  it('treats Path/PATH case-insensitively on win32 only', () => {
    const inherited = { PATH: '/bin', OTHER: '1' }
    const overlay = { envSet: {}, envUnset: ['Path'] }
    expect(applyProfileEnvForPlatform(inherited, overlay, 'darwin')).toEqual(inherited)
    expect(applyProfileEnvForPlatform(inherited, overlay, 'win32')).toEqual({ OTHER: '1' })
  })
})
