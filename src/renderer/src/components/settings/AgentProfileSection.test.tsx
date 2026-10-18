// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { cleanup, render, screen } from '@testing-library/react'
import { AgentProfileSection } from './AgentProfileSection'
import type { AgentLaunchSettings } from '../../../../shared/agent-launch-settings'

afterEach(() => cleanup())

const BASE_SETTINGS = {
  defaultTuiAgent: null,
  disabledTuiAgents: [],
  agentDefaultArgs: {},
  environmentNames: {},
  agentProfiles: {},
  defaultAgentTarget: null,
  permissionMode: 'manual'
} as unknown as AgentLaunchSettings

describe('AgentProfileSection', () => {
  it('creates a profile from the editor', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn(async () => {})
    render(<AgentProfileSection settings={BASE_SETTINGS} mutate={mutate} />)
    await user.click(screen.getByRole('button', { name: /new profile/i }))
    await user.type(screen.getByLabelText(/name/i), 'Claude Trabajo')
    await user.type(screen.getByLabelText(/command/i), 'claude')
    await user.click(screen.getByRole('button', { name: /save profile/i }))
    await vi.waitFor(() => expect(mutate).toHaveBeenCalled())
    const calls = mutate.mock.calls as unknown[][]
    const mutation = calls[0]?.[0] as { type: string; profile: { id: string } }
    expect(mutation.type).toBe('profile-create')
    expect(mutation.profile.id).toBeTruthy()
  })

  it('requires name and command', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn(async () => {})
    render(<AgentProfileSection settings={BASE_SETTINGS} mutate={mutate} />)
    await user.click(screen.getByRole('button', { name: /new profile/i }))
    await user.click(screen.getByRole('button', { name: /save profile/i }))
    expect(screen.getByRole('alert')).toBeDefined()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('asks confirmation before delete and keeps the editor open on save failure', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn(async () => {
      throw new Error('offline')
    })
    const settings = {
      ...BASE_SETTINGS,
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
          envSet: {},
          envUnset: [],
          promptPolicy: 'argv'
        }
      }
    } as unknown as AgentLaunchSettings
    render(<AgentProfileSection settings={settings} mutate={mutate} />)
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(screen.getByRole('alertdialog')).toBeDefined()
    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[1]!)
    await vi.waitFor(() => expect(mutate).toHaveBeenCalled())
    // Editor stays open: the error alert renders instead of closing the dialog.
    expect(screen.getByRole('alert')).toBeDefined()
  })
})
