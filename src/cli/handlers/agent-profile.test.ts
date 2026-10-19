// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_PROFILE_HANDLERS } from './agent-profile'

function clientWith(settings: unknown, onCall?: (method: string, params?: unknown) => unknown) {
  const calls: { method: string; params?: unknown }[] = []
  const client = {
    call: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      if (onCall) {
        return onCall(method, params) as never
      }
      return { result: { settings } } as never
    })
  }
  return { client, calls }
}

const SETTINGS = {
  agentProfiles: {
    work: {
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
      envNames: ['CLAUDE_CONFIG_DIR'],
      promptPolicy: 'argv'
    }
  }
}

describe('agent profile CLI', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('lists profiles without secret values', async () => {
    const { client, calls } = clientWith(SETTINGS)
    await AGENT_PROFILE_HANDLERS['agent profile list']({
      flags: new Map(),
      client: client as never,
      cwd: '/tmp',
      json: false
    })
    expect(calls[0]?.method).toBe('settings.getAgentLaunch')
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0]))
      .join('\n')
    expect(output).toContain('work')
    expect(output).not.toContain('/work/.claude')
  })

  it('shows a single profile without secret values', async () => {
    const { client } = clientWith(SETTINGS)
    await AGENT_PROFILE_HANDLERS['agent profile show']({
      flags: new Map([['id', 'work']]),
      client: client as never,
      cwd: '/tmp',
      json: false
    })
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => String(call[0]))
      .join('\n')
    expect(output).toContain('Claude Trabajo')
    expect(output).not.toContain('/work/.claude')
  })

  it('rejects unknown profiles and bad env-set', async () => {
    const { client } = clientWith(SETTINGS)
    await expect(
      AGENT_PROFILE_HANDLERS['agent profile show']({
        flags: new Map([['id', 'missing']]),
        client: client as never,
        cwd: '/tmp',
        json: false
      })
    ).rejects.toThrow('Unknown profile')
    await expect(
      AGENT_PROFILE_HANDLERS['agent profile create']({
        flags: new Map([
          ['id', 'x'],
          ['label', 'X'],
          ['command', 'claude'],
          ['env-set', 'NOEQUALS']
        ]),
        client: client as never,
        cwd: '/tmp',
        json: false
      })
    ).rejects.toThrow('Bad --env-set')
  })
})
