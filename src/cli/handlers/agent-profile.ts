import type { CommandHandler } from '../dispatch'
import { getRepeatedStringFlag, getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import type { RuntimeRpcSuccess } from '../runtime-client'
import type { AgentLaunchSettings } from '../../shared/agent-launch-settings'
import type { AgentProfileSummary } from '../../shared/agent-launch-profile'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'

function localSuccess<TResult>(result: TResult): RuntimeRpcSuccess<TResult> {
  return { id: 'local', ok: true as const, result, _meta: { runtimeId: 'local' } }
}

function readEnvSet(flags: Map<string, string | boolean>): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const entry of getRepeatedStringFlag(flags, 'env-set')) {
    const separator = entry.indexOf('=')
    if (separator <= 0) {
      throw new RuntimeClientError('invalid_argument', `Bad --env-set (want KEY=VALUE): ${entry}`)
    }
    parsed[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  return parsed
}

function formatProfileList(profiles: AgentProfileSummary[]): string {
  if (profiles.length === 0) {
    return 'No custom profiles.'
  }
  return profiles
    .map((profile) => `${profile.id}\t${profile.label}\t${profile.command} ${profile.args}`.trim())
    .join('\n')
}

function formatProfileShow(profile: AgentProfileSummary | null): string {
  if (!profile) {
    return 'Profile not found.'
  }
  return [
    `id: ${profile.id}`,
    `label: ${profile.label}`,
    `command: ${profile.command} ${profile.args}`.trim(),
    `base: ${profile.baseProvider ?? 'generic'}`,
    `env: ${profile.envNames.join(', ') || '(none)'}`
  ].join('\n')
}

async function readSettings(client: {
  call: <T>(method: string, params?: unknown) => Promise<{ result: T }>
}): Promise<AgentLaunchSettings> {
  const response = await client.call<{ settings: AgentLaunchSettings }>('settings.getAgentLaunch')
  return response.result.settings
}

export const AGENT_PROFILE_HANDLERS: Record<string, CommandHandler> = {
  'agent profile list': async ({ client, json }) => {
    const settings = await readSettings(client)
    const profiles = Object.values(settings.agentProfiles ?? {})
    printResult(localSuccess(profiles), json, formatProfileList)
  },
  'agent profile show': async ({ client, flags, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const settings = await readSettings(client)
    const profile = settings.agentProfiles?.[id] ?? null
    if (!profile) {
      throw new RuntimeClientError('not_found', `Unknown profile: ${id}`)
    }
    printResult(localSuccess(profile), json, formatProfileShow)
  },
  'agent profile create': async ({ client, flags, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    const label = getRequiredStringFlag(flags, 'label')
    const command = getRequiredStringFlag(flags, 'command')
    const baseProvider = flags.get('base-provider')
    const args = flags.get('args')
    const promptPolicy = flags.get('prompt-policy')
    const promptFlag = flags.get('prompt-flag')
    const response = await client.call<{ settings: AgentLaunchSettings }>(
      'settings.mutateAgentLaunch',
      {
        type: 'profile-create',
        profile: {
          id,
          label,
          ownerHostId: LOCAL_EXECUTION_HOST_ID,
          baseProvider: typeof baseProvider === 'string' ? baseProvider : null,
          enabled: true,
          revisionId: `rev-cli-${Date.now().toString(36)}`,
          command,
          args: typeof args === 'string' ? args : '',
          envSet: readEnvSet(flags),
          envUnset: getRepeatedStringFlag(flags, 'env-unset'),
          promptPolicy:
            promptPolicy === 'flag' ||
            promptPolicy === 'stdin-after-start' ||
            promptPolicy === 'stdin'
              ? promptPolicy === 'stdin'
                ? 'stdin-after-start'
                : promptPolicy
              : 'argv',
          ...(typeof promptFlag === 'string' && promptFlag.length > 0 ? { promptFlag } : {})
        }
      }
    )
    const created = response.result.settings.agentProfiles?.[id] ?? null
    if (!created) {
      throw new RuntimeClientError('internal', 'Profile create did not persist.')
    }
    printResult(localSuccess(created), json, formatProfileShow)
  },
  'agent profile remove': async ({ client, flags, json }) => {
    const id = getRequiredStringFlag(flags, 'id')
    await client.call('settings.mutateAgentLaunch', { type: 'profile-remove', id })
    printResult(localSuccess(id), json, (result: string) => `Removed ${result}.`)
  }
}
