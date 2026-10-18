import type { GlobalSettings } from './global-settings-types'
import type { TuiAgent } from './tui-agent'
import { AgentProfileDescriptor, type AgentLaunchTarget } from './agent-launch-profile'
import { buildDefaultAgentSettingsUpdate } from './default-agent-settings'
import {
  buildAgentAvailabilitySettingsUpdate,
  normalizeDisabledTuiAgents
} from './tui-agent-selection'
import { normalizeTuiAgentArgsRecord, resolveTuiAgentLaunchEnv } from './tui-agent-launch-defaults'
import {
  applyAgentPermissionMode,
  resolveAgentPermissionModeSummary,
  type AgentPermissionMode
} from './tui-agent-permissions'

export type AgentLaunchSettingsSource = Partial<
  Pick<
    GlobalSettings,
    | 'defaultTuiAgent'
    | 'newWorkspaceSetupOnly'
    | 'disabledTuiAgents'
    | 'agentCmdOverrides'
    | 'agentDefaultArgs'
    | 'agentDefaultEnv'
    | 'agentProfiles'
    | 'defaultAgentTarget'
  >
>

export type AgentLaunchSettings = {
  defaultTuiAgent: GlobalSettings['defaultTuiAgent']
  newWorkspaceSetupOnly?: boolean
  disabledTuiAgents: TuiAgent[]
  agentCmdOverrides: NonNullable<GlobalSettings['agentCmdOverrides']>
  agentDefaultArgs: NonNullable<GlobalSettings['agentDefaultArgs']>
  environmentNames: Partial<Record<TuiAgent, string[]>>
  agentProfiles: Record<string, AgentProfileDescriptor>
  defaultAgentTarget: AgentLaunchTarget | 'blank' | null
  permissionMode: AgentPermissionMode
}

export type AgentLaunchSettingsMutation =
  | { type: 'default'; agent: GlobalSettings['defaultTuiAgent']; setupOnly?: boolean }
  | { type: 'availability'; agent: TuiAgent; enabled: boolean }
  | { type: 'permissions'; mode: Exclude<AgentPermissionMode, 'mixed'> }
  | { type: 'command'; agent: TuiAgent; value: string }
  | { type: 'arguments'; agent: TuiAgent; value: string }
  | { type: 'environment-set'; agent: TuiAgent; name: string; value: string }
  | { type: 'environment-remove'; agent: TuiAgent; name: string }
  | { type: 'profile-create'; profile: AgentProfileDescriptor }
  | { type: 'profile-update'; id: string; patch: Partial<AgentProfileDescriptor> }
  | { type: 'profile-remove'; id: string }
  | { type: 'profile-default'; target: AgentLaunchTarget | 'blank' | null }

export function projectAgentLaunchSettings(
  settings: AgentLaunchSettingsSource
): AgentLaunchSettings {
  return {
    defaultTuiAgent: settings.defaultTuiAgent ?? null,
    newWorkspaceSetupOnly: false,
    disabledTuiAgents: normalizeDisabledTuiAgents(settings.disabledTuiAgents),
    agentCmdOverrides: { ...settings.agentCmdOverrides },
    agentDefaultArgs: normalizeTuiAgentArgsRecord(settings.agentDefaultArgs),
    environmentNames: Object.fromEntries(
      Object.entries(settings.agentDefaultEnv ?? {}).map(([agent, env]) => [
        agent,
        Object.keys(env ?? {}).sort()
      ])
    ),
    agentProfiles: { ...settings.agentProfiles },
    defaultAgentTarget: settings.defaultAgentTarget ?? null,
    permissionMode: resolveAgentPermissionModeSummary(settings)
  }
}

export function agentLaunchSettingsMutationUpdates(
  settings: AgentLaunchSettingsSource,
  mutation: AgentLaunchSettingsMutation,
  platform: NodeJS.Platform
): AgentLaunchSettingsSource {
  switch (mutation.type) {
    case 'default':
      return buildDefaultAgentSettingsUpdate(mutation.agent)
    case 'availability':
      return buildAgentAvailabilitySettingsUpdate(
        {
          defaultTuiAgent: settings.defaultTuiAgent ?? null,
          disabledTuiAgents: settings.disabledTuiAgents ?? []
        },
        mutation.agent,
        mutation.enabled
      )
    case 'permissions':
      return applyAgentPermissionMode({ ...settings, mode: mutation.mode })
    case 'command': {
      const commands = { ...settings.agentCmdOverrides }
      if (mutation.value.trim()) {
        commands[mutation.agent] = mutation.value.trim()
      } else {
        delete commands[mutation.agent]
      }
      return { agentCmdOverrides: commands }
    }
    case 'arguments':
      return {
        agentDefaultArgs: normalizeTuiAgentArgsRecord({
          ...settings.agentDefaultArgs,
          [mutation.agent]: mutation.value
        })
      }
    case 'environment-set':
    case 'environment-remove': {
      const env = { ...resolveTuiAgentLaunchEnv(mutation.agent, settings.agentDefaultEnv) }
      // Windows environment names are case insensitive on the execution host.
      for (const name of Object.keys(env)) {
        if (
          name === mutation.name ||
          (platform === 'win32' && name.toLowerCase() === mutation.name.toLowerCase())
        ) {
          delete env[name]
        }
      }
      const nextEnv =
        mutation.type === 'environment-set' ? { ...env, [mutation.name]: mutation.value } : env
      return { agentDefaultEnv: { ...settings.agentDefaultEnv, [mutation.agent]: nextEnv } }
    }
    case 'profile-create': {
      const parsed = AgentProfileDescriptor.safeParse(mutation.profile)
      if (!parsed.success) {
        throw new Error(`Invalid profile: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
      }
      return { agentProfiles: { ...settings.agentProfiles, [parsed.data.id]: parsed.data } }
    }
    case 'profile-update': {
      const existing = settings.agentProfiles?.[mutation.id]
      if (!existing) {
        throw new Error(`Unknown profile: ${mutation.id}`)
      }
      const parsed = AgentProfileDescriptor.safeParse({
        ...existing,
        ...mutation.patch,
        id: mutation.id
      })
      if (!parsed.success) {
        throw new Error(`Invalid profile: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
      }
      return { agentProfiles: { ...settings.agentProfiles, [mutation.id]: parsed.data } }
    }
    case 'profile-remove': {
      const next = { ...settings.agentProfiles }
      delete next[mutation.id]
      const current: AgentLaunchTarget | 'blank' | null | undefined = settings.defaultAgentTarget
      const clearingDefault =
        current !== undefined &&
        current !== null &&
        current !== 'blank' &&
        current.kind === 'profile' &&
        current.profileId === mutation.id
      return {
        agentProfiles: next,
        ...(clearingDefault ? { defaultAgentTarget: null } : {})
      }
    }
    case 'profile-default':
      return { defaultAgentTarget: mutation.target }
  }
}
