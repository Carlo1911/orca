import type { GlobalSettings } from './global-settings-types'
import type { TuiAgent } from './tui-agent'
import type { AgentLaunchTarget } from './agent-launch-profile'
type DefaultAgentSettings = Pick<GlobalSettings, 'defaultTuiAgent' | 'newWorkspaceSetupOnly'>

export function buildDefaultAgentSettingsUpdate(
  next: TuiAgent | 'blank' | null
): DefaultAgentSettings {
  // Clear the retired flag so older peers also see a regular agent or shell default.
  return { defaultTuiAgent: next, newWorkspaceSetupOnly: false }
}

/**
 * U5: a profile default is new data on `defaultAgentTarget`, never an id
 * stuffed into the legacy `defaultTuiAgent` builtin slot.
 */
export function buildProfileDefaultTargetUpdate(
  target: AgentLaunchTarget | 'blank' | null
): Pick<GlobalSettings, 'defaultAgentTarget' | 'newWorkspaceSetupOnly'> {
  return { defaultAgentTarget: target, newWorkspaceSetupOnly: false }
}
