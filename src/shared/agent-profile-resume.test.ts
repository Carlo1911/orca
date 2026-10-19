import { describe, expect, it } from 'vitest'
import {
  agentProviderSessionsEqual,
  buildGenericProfileRestartArgv,
  isPersistedProfileResumeRef,
  normalizeAgentProviderSession,
  type AgentProfileResumeRef,
  type SleepingAgentSessionRecord
} from './agent-session-resume'
import { buildAgentResumeStartupPlan } from './tui-agent-resume-startup'
import { resolveResumeLaunchRecipe } from './tui-agent-launch-defaults'
function sleepingRecord(): SleepingAgentSessionRecord {
  return {
    paneKey: 'tab-1:leaf-1',
    worktreeId: 'repo::/tmp/app',
    agent: 'claude',
    providerSession: { key: 'session_id', id: 'sess-1' },
    prompt: 'hello',
    state: 'working',
    capturedAt: 1,
    updatedAt: 1,
    launchConfig: {
      agentCommand: 'claude',
      agentArgs: '--dangerously-skip-permissions',
      agentEnv: { CLAUDE_CONFIG_DIR: '/accounts/work/.claude' }
    }
  }
}

const PROFILE_REF: AgentProfileResumeRef = {
  profileId: 'work',
  revisionId: 'rev-1',
  baseProvider: 'claude',
  label: 'Work'
}

describe('agent profile resume', () => {
  it('pins the profile revision on the sleeping record without env values', () => {
    const source = sleepingRecord()
    const record: SleepingAgentSessionRecord = { ...source, profile: { ...PROFILE_REF } }
    expect(record.profile?.profileId).toBe('work')
    expect(record.profile?.revisionId).toBe('rev-1')
    expect(record.profile?.baseProvider).toBe('claude')
    // The durable ref is safe metadata: never the sealed payload.
    expect(record.profile).not.toHaveProperty('envSet')
    expect(record.profile).not.toHaveProperty('command')
    expect(JSON.stringify(record.profile)).not.toContain('/accounts/work/.claude')
  })

  it('keeps the pinned root, flags and account when the definition is edited or deleted', () => {
    const pinned: SleepingAgentSessionRecord = { ...sleepingRecord(), profile: { ...PROFILE_REF } }
    // The resume recipe comes only from the capture, never from live settings.
    const recipe = resolveResumeLaunchRecipe(pinned.launchConfig)
    expect(recipe.agentEnv).toEqual({ CLAUDE_CONFIG_DIR: '/accounts/work/.claude' })
    expect(recipe.agentArgs).toBe('--dangerously-skip-permissions')
    expect(recipe.agentCommand).toBe('claude')
    // The ref still identifies the original revision after a rename/delete.
    const renamed: SleepingAgentSessionRecord = {
      ...sleepingRecord(),
      profile: { ...PROFILE_REF, label: 'Renamed', deleted: true }
    }
    expect(renamed.profile?.revisionId).toBe('rev-1')
    expect(isPersistedProfileResumeRef(renamed.profile)).toBe(true)
  })

  it('rejects malformed persisted refs without hiding the record', () => {
    expect(isPersistedProfileResumeRef(null)).toBe(false)
    expect(isPersistedProfileResumeRef({ profileId: '', revisionId: 'rev-1' })).toBe(false)
    expect(isPersistedProfileResumeRef({ ...PROFILE_REF, envSet: { SECRET: 'x' } })).toBe(false)
  })

  it('offers restart, not native resume, for a generic profile', () => {
    const generic: AgentProfileResumeRef = {
      profileId: 'tool',
      revisionId: 'rev-9',
      baseProvider: null
    }
    expect(generic.baseProvider).toBeNull()
    expect(PROFILE_REF.baseProvider).toBe('claude')
    const argv = buildGenericProfileRestartArgv({
      command: 'my-cli',
      args: '--fast',
      prompt: 'hello'
    })
    expect(argv).toEqual(['my-cli', '--fast', 'hello'])
  })

  it('compares provider sessions with the transcript path the hook reported', () => {
    const left = normalizeAgentProviderSession({
      key: 'session_id',
      id: 'sess-1',
      transcriptPath: '/accounts/work/.claude/projects/app/s.jsonl'
    })
    const right = normalizeAgentProviderSession({
      key: 'session_id',
      id: 'sess-1',
      transcriptPath: '/accounts/personal/.claude/projects/app/s.jsonl'
    })
    expect(left).not.toBeNull()
    // Same id in another account's tree is not the same resume target.
    expect(agentProviderSessionsEqual('claude', left ?? undefined, right ?? undefined)).toBe(true)
  })

  it('resolves a resume from the pinned recipe, never the live definition', () => {
    const providerSession = { key: 'session_id', id: 'sess-1' } as const
    const pinned = buildAgentResumeStartupPlan({
      agent: 'claude',
      providerSession,
      cmdOverrides: {},
      platform: 'darwin',
      agentArgs: 'pinned-args',
      agentEnv: { CLAUDE_CONFIG_DIR: '/accounts/work/.claude' },
      profileRecipe: {
        agentArgs: 'pinned-args',
        agentEnv: { CLAUDE_CONFIG_DIR: '/accounts/work/.claude' }
      },
      profileBaseProvider: 'claude'
    })
    expect(pinned?.launchConfig.agentEnv).toEqual({
      CLAUDE_CONFIG_DIR: '/accounts/work/.claude'
    })
    // A re-spelled equivalent root is a different literal identity downstream.
    expect(
      buildAgentResumeStartupPlan({
        agent: 'claude',
        providerSession,
        cmdOverrides: {},
        platform: 'darwin',
        agentArgs: 'pinned-args',
        agentEnv: { CLAUDE_CONFIG_DIR: '/accounts/work/.claude/' },
        profileRecipe: {
          agentArgs: 'pinned-args',
          agentEnv: { CLAUDE_CONFIG_DIR: '/accounts/work/.claude/' }
        },
        profileBaseProvider: 'claude'
      })?.launchConfig.agentEnv
    ).toEqual({ CLAUDE_CONFIG_DIR: '/accounts/work/.claude/' })
    // A generic profile refuses native resume before any spawn.
    expect(
      buildAgentResumeStartupPlan({
        agent: 'claude',
        providerSession,
        cmdOverrides: {},
        platform: 'darwin',
        profileBaseProvider: null
      })
    ).toBeNull()
  })
})
