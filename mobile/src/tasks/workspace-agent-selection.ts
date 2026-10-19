import type { TuiAgent } from '../../../src/shared/tui-agent'
import {
  filterEnabledMobileTuiAgents,
  isMobileTuiAgent,
  isMobileTuiAgentEnabled,
  MOBILE_TUI_AGENT_AUTO_PICK_ORDER,
  MOBILE_TUI_AGENT_LABELS,
  pickMobileTuiAgent
} from './mobile-tui-agents'

export type WorkspaceAgentChoice = TuiAgent | 'blank' | { kind: 'profile'; profileId: string }

/** Opaque profile ref a client nuevo resuelve contra descriptores del host. Nunca se finge builtin. */
export function normalizeWorkspaceProfile(
  value: unknown
): { kind: 'profile'; profileId: string } | null {
  if (typeof value !== 'string' || !value.startsWith('profile:')) {
    return null
  }
  const profileId = value.slice('profile:'.length)
  return profileId.length > 0 ? { kind: 'profile', profileId } : null
}

type WorkspaceAgentSettings = {
  defaultTuiAgent?: TuiAgent | 'blank' | null
  disabledTuiAgents?: unknown
}

export type WorkspaceAgentSelectionState = {
  agent: WorkspaceAgentChoice | null
  overridden: boolean
}

type ResolveWorkspaceAgentSelectionArgs = WorkspaceAgentSelectionState & {
  selectionActive: boolean
  settings: WorkspaceAgentSettings
  detectedAgentIds: Set<string> | null
}

export function workspaceAgentLabel(agent: WorkspaceAgentChoice): string {
  if (agent === 'blank') {
    return 'Blank Terminal'
  }
  if (typeof agent !== 'string') {
    return agent.profileId
  }
  return MOBILE_TUI_AGENT_LABELS[agent]
}

export function normalizeWorkspaceAgent(value: unknown): WorkspaceAgentChoice | null {
  if (value === 'blank' || value === '__blank__') {
    return 'blank'
  }
  return normalizeWorkspaceProfile(value) ?? (isMobileTuiAgent(value) ? value : null)
}

export function pickWorkspaceAgent(
  settings: WorkspaceAgentSettings,
  detectedAgentIds: Set<string> | null
): WorkspaceAgentChoice {
  const preferred = normalizeWorkspaceAgent(settings.defaultTuiAgent)
  if (preferred === 'blank' || (preferred !== null && typeof preferred !== 'string')) {
    return preferred ?? 'blank'
  }
  const disabled = settings.disabledTuiAgents
  const enabledAutoPickOrder = filterEnabledMobileTuiAgents(
    MOBILE_TUI_AGENT_AUTO_PICK_ORDER,
    disabled
  )
  if (detectedAgentIds === null) {
    return preferred && isMobileTuiAgentEnabled(preferred, disabled)
      ? preferred
      : (enabledAutoPickOrder[0] ?? 'blank')
  }
  const detectedAgents = enabledAutoPickOrder.filter((agent) => detectedAgentIds.has(agent))
  return pickMobileTuiAgent(preferred, detectedAgents, disabled) ?? 'blank'
}

export function filterWorkspaceAgents(agents: readonly TuiAgent[], disabled?: unknown): TuiAgent[] {
  return filterEnabledMobileTuiAgents(agents, disabled)
}

export function isWorkspaceAgentEnabled(agent: TuiAgent, disabled?: unknown): boolean {
  return isMobileTuiAgentEnabled(agent, disabled)
}

export function resolveWorkspaceAgentSelection({
  selectionActive,
  settings,
  detectedAgentIds,
  agent,
  overridden
}: ResolveWorkspaceAgentSelectionArgs): WorkspaceAgentSelectionState {
  const current = { agent, overridden }
  if (!selectionActive) {
    return current
  }

  const pickedAgent = pickWorkspaceAgent(settings, detectedAgentIds)
  if (!overridden) {
    return agent === pickedAgent ? current : { agent: pickedAgent, overridden: false }
  }

  if (typeof agent !== 'string') {
    // Explicit profile pick stays visible; the host rejects at launch if gone.
    return current
  }
  if (
    detectedAgentIds === null ||
    !agent ||
    agent === 'blank' ||
    (detectedAgentIds.has(agent) && isWorkspaceAgentEnabled(agent, settings.disabledTuiAgents))
  ) {
    return current
  }

  return { agent: pickedAgent, overridden: false }
}
