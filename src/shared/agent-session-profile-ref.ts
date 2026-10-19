/**
 * Pinned launch-profile reference fixed at admission (KTD3): profile id,
 * revision id and base provider. Safe metadata — never the sealed recipe —
 * so a renamed or deleted definition keeps its history and pinned identity.
 */
export type AgentSessionProfileRef = {
  profileId: string
  revisionId: string
  baseProvider: string | null
  label?: string
  deleted?: true
}

export function isAgentSessionProfileRef(value: unknown): value is AgentSessionProfileRef {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  // Exact keys: the sealed recipe payload (`envSet`/`command`) must never land here.
  if (
    !Object.keys(record).every((key) =>
      ['profileId', 'revisionId', 'baseProvider', 'label', 'deleted'].includes(key)
    )
  ) {
    return false
  }
  if (
    typeof record.profileId !== 'string' ||
    record.profileId.length === 0 ||
    typeof record.revisionId !== 'string' ||
    record.revisionId.length === 0
  ) {
    return false
  }
  if (typeof record.baseProvider !== 'string' && record.baseProvider !== null) {
    return false
  }
  if (record.label !== undefined && typeof record.label !== 'string') {
    return false
  }
  return record.deleted === undefined || record.deleted === true
}
