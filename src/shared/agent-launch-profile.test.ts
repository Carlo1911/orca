import { describe, expect, it } from 'vitest'
import {
  AgentProfileDescriptor,
  isAgentLaunchTarget,
  parseProfileSelector,
  toAgentProfileSummary
} from './agent-launch-profile'

const BASE = {
  label: 'Claude Trabajo',
  ownerHostId: 'host-1',
  enabled: true,
  revisionId: 'rev-1',
  command: 'claude',
  args: '',
  envSet: {},
  envUnset: [] as string[],
  promptPolicy: 'argv' as const
}

describe('agent-launch-profile', () => {
  it('accepts a derived profile sharing an executable with another', () => {
    const personal = AgentProfileDescriptor.parse({ ...BASE, id: 'claude-personal' })
    const work = AgentProfileDescriptor.parse({
      ...BASE,
      id: 'claude-work',
      baseProvider: 'claude',
      envSet: { CLAUDE_CONFIG_DIR: '/work/.claude' }
    })
    expect(personal.id).toBe('claude-personal')
    expect(work.baseProvider).toBe('claude')
    // Same executable, distinct durable selectors.
    expect(personal.command).toBe(work.command)
    expect(personal.id).not.toBe(work.id)
  })

  it('accepts a generic CLI with no base provider', () => {
    const generic = AgentProfileDescriptor.parse({
      ...BASE,
      id: 'my-cli',
      baseProvider: null,
      command: '/usr/local/bin/agent',
      promptPolicy: 'stdin-after-start'
    })
    expect(generic.baseProvider).toBeNull()
  })

  it('rejects empty ids, bad env names, and nul bytes', () => {
    expect(() => AgentProfileDescriptor.parse({ ...BASE, id: '' })).toThrow()
    expect(() =>
      AgentProfileDescriptor.parse({ ...BASE, id: 'ok', envSet: { 'BAD-NAME': 'x' } })
    ).toThrow()
    expect(() => AgentProfileDescriptor.parse({ ...BASE, id: 'ok', command: 'a\0b' })).toThrow()
  })

  it('projects summaries without env values', () => {
    const profile = AgentProfileDescriptor.parse({
      ...BASE,
      id: 'p1',
      envSet: { SECRET_TOKEN: 's3cr3t' },
      envUnset: ['LEGACY']
    })
    const summary = toAgentProfileSummary(profile)
    expect(summary.envNames).toEqual(['SECRET_TOKEN'])
    expect(summary.envUnset).toEqual(['LEGACY'])
    expect(JSON.stringify(summary)).not.toContain('s3cr3t')
  })

  it('parses profile: selectors and validates targets', () => {
    expect(parseProfileSelector('profile:abc')).toBe('abc')
    expect(parseProfileSelector('claude')).toBeNull()
    expect(parseProfileSelector('profile:')).toBeNull()
    expect(isAgentLaunchTarget({ kind: 'builtin', agent: 'claude' })).toBe(true)
    expect(isAgentLaunchTarget({ kind: 'profile', profileId: 'abc' })).toBe(true)
    expect(isAgentLaunchTarget({ kind: 'profile', profileId: '' })).toBe(false)
    expect(isAgentLaunchTarget({ kind: 'builtin', agent: 'nope' })).toBe(false)
  })
})
