import type { TuiAgent } from './tui-agent'
export type { TuiAgent } from './tui-agent'
import type { AgentProfileId } from './agent-launch-profile'

// Why: recognizing a manually started agent must not register an Orca launcher.
export type TerminalAgent = TuiAgent | 'dsb'

/** A launch that names a profile instead of a built-in agent. */
export type ProfileTerminalTarget = { profileId: AgentProfileId }
