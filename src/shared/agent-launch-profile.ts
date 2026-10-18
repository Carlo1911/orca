import { z } from 'zod'
import { isTuiAgent } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'

/** Stable opaque profile id: non-empty, URL/hostname-safe, no secrets. */
export const AgentProfileId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid profile id')

export type AgentProfileId = z.infer<typeof AgentProfileId>
/** Base provider for a derived profile, or `null` for a generic CLI. */
const AgentBaseProvider = z.string().refine((value) => isTuiAgent(value), 'Unknown agent')

const AgentProfileBaseProvider = z.union([AgentBaseProvider, z.null()])

const ProfileCommand = z
  .string()
  .min(1)
  .max(8 * 1024)
  .refine((value) => !value.includes('\0'), 'Invalid value')

const ProfileArgs = z
  .string()
  .max(8 * 1024)
  .refine((value) => !value.includes('\0'), 'Invalid value')

const EnvName = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid variable name')

const EnvValue = z
  .string()
  .max(32 * 1024)
  .refine((value) => !value.includes('\0'), 'Invalid value')

const EnvVarName = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * A custom agent profile: user-defined launch entry independent of the
 * built-in catalog. Two profiles may share one executable; the id (never
 * the label) is the durable selector.
 */
export const AgentProfileDescriptor = z
  .strictObject({
    id: AgentProfileId,
    label: z.string().min(1).max(128),
    /** Host that owns this profile; resolved against the runtime, never the client OS. */
    ownerHostId: z.string().min(1).max(256),
    baseProvider: AgentProfileBaseProvider.default(null),
    enabled: z.boolean(),
    revisionId: z.string().min(1).max(128),
    command: ProfileCommand,
    args: ProfileArgs,
    /** Env overlay: set wins over inheritance; unset removes an inherited name. */
    envSet: z.record(z.string(), EnvValue),
    envUnset: z.array(EnvName),
    /** Prompt delivery: positional argv, a configured flag, or stdin-after-start. */
    promptPolicy: z.enum(['argv', 'flag', 'stdin']),
    /** Flag spelling used when `promptPolicy` is `flag`; absent otherwise. */
    promptFlag: z.string().max(64).optional()
  })
  .superRefine((value, ctx) => {
    for (const name of Object.keys(value.envSet)) {
      if (!EnvVarName.test(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid variable name',
          path: ['envSet', name]
        })
      }
    }
  })

export type AgentProfileDescriptor = z.infer<typeof AgentProfileDescriptor>

/** Public projection: metadata only, never env values. */
export type AgentProfileSummary = Pick<
  AgentProfileDescriptor,
  'id' | 'label' | 'ownerHostId' | 'baseProvider' | 'enabled' | 'revisionId' | 'command' | 'args'
> & {
  envNames: string[]
  envUnset: string[]
  promptPolicy: AgentProfileDescriptor['promptPolicy']
}

export function toAgentProfileSummary(profile: AgentProfileDescriptor): AgentProfileSummary {
  return {
    id: profile.id,
    label: profile.label,
    ownerHostId: profile.ownerHostId,
    baseProvider: profile.baseProvider,
    enabled: profile.enabled,
    revisionId: profile.revisionId,
    command: profile.command,
    args: profile.args,
    envNames: Object.keys(profile.envSet),
    envUnset: [...profile.envUnset],
    promptPolicy: profile.promptPolicy
  }
}

/**
 * Launch target: either a built-in agent or a profile reference. Code that
 * needs a `TuiAgent` keeps requiring one; profile-aware paths take the union.
 */
export type AgentLaunchTarget =
  | { kind: 'builtin'; agent: TuiAgent }
  | { kind: 'profile'; profileId: AgentProfileId }

export const AgentLaunchTargetSchema: z.ZodType<AgentLaunchTarget> = z.union([
  z.strictObject({
    kind: z.literal('builtin'),
    agent: z.string().refine((value) => isTuiAgent(value), 'Unknown agent')
  }),
  z.strictObject({ kind: z.literal('profile'), profileId: AgentProfileId })
])

export function isAgentLaunchTarget(value: unknown): value is AgentLaunchTarget {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const kind = (value as { kind?: unknown }).kind
  if (kind === 'builtin') {
    return isTuiAgent((value as { agent?: unknown }).agent)
  }
  if (kind === 'profile') {
    return AgentProfileId.safeParse((value as { profileId?: unknown }).profileId).success
  }
  return false
}

/** `profile:<id>` selector spelling accepted by `--agent` / `--provider`. */
export function parseProfileSelector(value: string): AgentProfileId | null {
  if (!value.startsWith('profile:')) {
    return null
  }
  const parsed = AgentProfileId.safeParse(value.slice('profile:'.length))
  return parsed.success ? parsed.data : null
}
