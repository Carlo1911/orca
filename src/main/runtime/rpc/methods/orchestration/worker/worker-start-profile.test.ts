import { describe, expect, it, vi } from 'vitest'
import { prepareLocalWorkerStart } from './worker-start-validation'

function runtimeWith(profiles: Record<string, unknown>) {
  return {
    getClientAgentLaunchSettings: () => ({ agentProfiles: profiles }),
    validateOrchestrationAgentLauncher: vi.fn(),
    resolveOrchestrationAgentLauncher: undefined
  } as never
}

const DERIVED = {
  id: 'work',
  label: 'Claude Trabajo',
  ownerHostId: 'host-1',
  baseProvider: 'claude',
  enabled: true,
  revisionId: 'rev-1',
  command: 'claude',
  args: '',
  envSet: { CLAUDE_CONFIG_DIR: '/work/.claude' },
  envUnset: [],
  promptPolicy: 'argv'
}

const GENERIC = { ...DERIVED, id: 'gen', baseProvider: null }

describe('worker profile selection', () => {
  it('resolves a derived profile to its base agent with the fixed recipe', () => {
    const runtime = runtimeWith({ work: DERIVED })
    const { agent, profileRecipe } = prepareLocalWorkerStart({
      params: { agent: 'profile:work' } as never,
      createsWorktree: false,
      runtime
    })
    expect(agent).toBe('claude')
    expect(profileRecipe?.profileId).toBe('work')
    expect(profileRecipe?.revisionId).toBe('rev-1')
  })

  it('rejects an unknown profile without falling back to a builtin', () => {
    const runtime = runtimeWith({})
    expect(() =>
      prepareLocalWorkerStart({
        params: { agent: 'profile:missing' } as never,
        createsWorktree: false,
        runtime
      })
    ).toThrow('Unknown or unavailable profile')
  })

  it('rejects generic profiles for workers explicitly', () => {
    const runtime = runtimeWith({ gen: GENERIC })
    expect(() =>
      prepareLocalWorkerStart({
        params: { agent: 'profile:gen' } as never,
        createsWorktree: false,
        runtime
      })
    ).toThrow('Generic profiles cannot start workers yet')
  })

  it('keeps builtin selection untouched', () => {
    const runtime = runtimeWith({ work: DERIVED })
    const { agent, profileRecipe } = prepareLocalWorkerStart({
      params: { agent: 'codex' } as never,
      createsWorktree: false,
      runtime
    })
    expect(agent).toBe('codex')
    expect(profileRecipe).toBeUndefined()
  })
})
