import { describe, expect, it } from 'vitest'
import {
  buildDefaultAgentSettingsUpdate,
  buildProfileDefaultTargetUpdate
} from './default-agent-settings'

describe('profile default target', () => {
  it('builds a profile default without touching the legacy builtin id', () => {
    expect(buildProfileDefaultTargetUpdate({ kind: 'profile', profileId: 'work' })).toEqual({
      defaultAgentTarget: { kind: 'profile', profileId: 'work' },
      newWorkspaceSetupOnly: false
    })
  })

  it('clears a profile default without stopping active sessions', () => {
    expect(buildProfileDefaultTargetUpdate(null)).toEqual({
      defaultAgentTarget: null,
      newWorkspaceSetupOnly: false
    })
  })
})
describe('default agent settings', () => {
  it.each(['blank', 'claude', null] as const)(
    'clears the retired setup-only flag for %s',
    (agent) => {
      expect(buildDefaultAgentSettingsUpdate(agent)).toEqual({
        defaultTuiAgent: agent,
        newWorkspaceSetupOnly: false
      })
    }
  )
})
