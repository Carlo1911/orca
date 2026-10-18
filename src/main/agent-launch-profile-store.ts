import {
  AgentProfileDescriptor,
  toAgentProfileSummary,
  type AgentProfileDescriptor as ProfileRecord,
  type AgentProfileSummary
} from '../shared/agent-launch-profile'
/** Slot namespace for sealed recipe payloads; the descriptor carries no secrets. */
export function profileRecipeSlot(profileId: string): string {
  return `agentProfile.recipe:${profileId}`
}

export type SealedProfileRecipe = {
  revisionId: string
  command: string
  args: string
  envSet: Record<string, string>
  envUnset: string[]
  promptPolicy: ProfileRecord['promptPolicy']
  promptFlag?: string
  sealedAt: number
}

export type ProfileCreateInput = {
  id: string
  label: string
  ownerHostId: string
  baseProvider: ProfileRecord['baseProvider']
  command: string
  args?: string
  envSet?: Record<string, string>
  envUnset?: string[]
  promptPolicy?: ProfileRecord['promptPolicy']
  promptFlag?: string
}

export type ProfileUpdateInput = {
  label?: string
  baseProvider?: ProfileRecord['baseProvider']
  command?: string
  args?: string
  envSet?: Record<string, string>
  envUnset?: string[]
  promptPolicy?: ProfileRecord['promptPolicy']
  promptFlag?: string | null
  enabled?: boolean
}

export type ProfileMutationError =
  | { kind: 'invalid'; message: string }
  | { kind: 'duplicate' }
  | { kind: 'missing' }
  | { kind: 'seal-failed'; message: string }
  | { kind: 'referenced'; references: string[] }

/**
 * Host-owned profile definitions with sealed recipes. Descriptors are durable
 * metadata; env values live only in the sealed payload. Edits mint a new
 * recipe revision; prior revisions survive while referenced (KTD3). A recipe
 * is sealed and persisted before its descriptor is published (KTD10).
 */
export class AgentLaunchProfileStore {
  private readonly secrets: (slot: string, plaintext: string) => { blob: string; degraded: boolean }
  private definitions = new Map<string, ProfileRecord>()
  private recipes = new Map<string, { revisionId: string; sealed: string }>()
  private revisionCounter = 0
  /** revisionId -> set of referencing operation ids (sessions, runs, automations). */
  private readonly references = new Map<string, Set<string>>()

  constructor(deps: {
    seal: (slot: string, plaintext: string) => { blob: string; degraded: boolean }
  }) {
    this.secrets = deps.seal
  }

  list(): AgentProfileSummary[] {
    return [...this.definitions.values()].map(toAgentProfileSummary)
  }

  get(id: string): ProfileRecord | null {
    return this.definitions.get(id) ?? null
  }

  revisionFor(profileId: string): string | null {
    return this.definitions.get(profileId)?.revisionId ?? null
  }

  create(input: ProfileCreateInput): ProfileRecord | ProfileMutationError {
    if (this.definitions.has(input.id)) {
      return { kind: 'duplicate' }
    }
    const parsed = AgentProfileDescriptor.safeParse({
      id: input.id,
      label: input.label,
      ownerHostId: input.ownerHostId,
      baseProvider: input.baseProvider ?? null,
      enabled: true,
      revisionId: this.nextRevisionId(),
      command: input.command,
      args: input.args ?? '',
      envSet: input.envSet ?? {},
      envUnset: input.envUnset ?? [],
      promptPolicy: input.promptPolicy ?? 'argv',
      ...(input.promptFlag !== undefined ? { promptFlag: input.promptFlag } : {})
    })
    if (!parsed.success) {
      return { kind: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid profile' }
    }
    const sealed = this.sealRecipe(parsed.data)
    if (!sealed.ok) {
      return sealed.error
    }
    this.definitions.set(parsed.data.id, parsed.data)
    this.recipes.set(parsed.data.id, { revisionId: parsed.data.revisionId, sealed: sealed.blob })
    return parsed.data
  }

  update(id: string, patch: ProfileUpdateInput): ProfileRecord | ProfileMutationError {
    const existing = this.definitions.get(id)
    if (!existing) {
      return { kind: 'missing' }
    }
    const parsed = AgentProfileDescriptor.safeParse({
      ...existing,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.baseProvider !== undefined ? { baseProvider: patch.baseProvider } : {}),
      ...(patch.command !== undefined ? { command: patch.command } : {}),
      ...(patch.args !== undefined ? { args: patch.args } : {}),
      ...(patch.envSet !== undefined ? { envSet: patch.envSet } : {}),
      ...(patch.envUnset !== undefined ? { envUnset: patch.envUnset } : {}),
      ...(patch.promptPolicy !== undefined ? { promptPolicy: patch.promptPolicy } : {}),
      ...(patch.promptFlag !== undefined
        ? patch.promptFlag === null
          ? { promptFlag: undefined }
          : { promptFlag: patch.promptFlag }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      revisionId: this.nextRevisionId()
    })
    if (!parsed.success) {
      return { kind: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid profile' }
    }
    // KTD10: seal before publishing. A failed seal keeps the prior revision live.
    const sealed = this.sealRecipe(parsed.data)
    if (!sealed.ok) {
      return sealed.error
    }
    this.definitions.set(id, parsed.data)
    this.recipes.set(id, { revisionId: parsed.data.revisionId, sealed: sealed.blob })
    return parsed.data
  }

  remove(id: string, referencedBy: (profileId: string) => string[]): true | ProfileMutationError {
    if (!this.definitions.has(id)) {
      return { kind: 'missing' }
    }
    const references = referencedBy(id)
    if (references.length > 0) {
      return { kind: 'referenced', references }
    }
    this.definitions.delete(id)
    this.recipes.delete(id)
    this.collectGarbage()
    return true
  }

  /** Record that an operation pins a revision; unreferenced revisions are freed. */
  retain(revisionId: string, operationId: string): void {
    let holders = this.references.get(revisionId)
    if (!holders) {
      holders = new Set()
      this.references.set(revisionId, holders)
    }
    holders.add(operationId)
  }

  release(revisionId: string, operationId: string): void {
    const holders = this.references.get(revisionId)
    if (!holders) {
      return
    }
    holders.delete(operationId)
    if (holders.size === 0) {
      this.references.delete(revisionId)
    }
    this.collectGarbage()
  }

  private collectGarbage(): void {
    // Drop sealed payloads whose revision no live profile points at and no
    // retained operation holds. Descriptors carry no secrets, so only sealed
    // payloads need freeing.
    for (const [profileId, recipe] of this.recipes) {
      const live = this.definitions.get(profileId)?.revisionId === recipe.revisionId
      if (!live && !this.references.has(recipe.revisionId)) {
        this.recipes.delete(profileId)
      }
    }
  }

  private nextRevisionId(): string {
    this.revisionCounter += 1
    return `rev-${Date.now().toString(36)}-${this.revisionCounter}`
  }

  private sealRecipe(
    profile: ProfileRecord
  ): { ok: true; blob: string } | { ok: false; error: ProfileMutationError } {
    const payload: SealedProfileRecipe = {
      revisionId: profile.revisionId,
      command: profile.command,
      args: profile.args,
      envSet: profile.envSet,
      envUnset: profile.envUnset,
      promptPolicy: profile.promptPolicy,
      ...(profile.promptFlag !== undefined ? { promptFlag: profile.promptFlag } : {}),
      sealedAt: Date.now()
    }
    let blob: string
    try {
      const sealed = this.secrets(profileRecipeSlot(profile.id), JSON.stringify(payload))
      if (sealed.degraded) {
        return {
          ok: false,
          error: { kind: 'seal-failed', message: 'Encryption unavailable; revision not published' }
        }
      }
      blob = sealed.blob
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: 'seal-failed',
          message: error instanceof Error ? error.message : 'Seal failed; revision not published'
        }
      }
    }
    if (!blob) {
      return {
        ok: false,
        error: { kind: 'seal-failed', message: 'Empty sealed payload; revision not published' }
      }
    }
    return { ok: true, blob }
  }
}
