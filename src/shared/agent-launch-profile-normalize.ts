import {
  AgentProfileDescriptor,
  type AgentProfileDescriptor as ProfileRecord
} from './agent-launch-profile'

/**
 * Normalize persisted profiles: keep valid descriptors, drop malformed rows
 * without failing the load. Secrets never live here — only the sealed recipe
 * payload holds env values (U2).
 */
export function normalizeAgentProfiles(value: unknown): Record<string, ProfileRecord> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const normalized: Record<string, ProfileRecord> = {}
  for (const [key, entry] of Object.entries(value)) {
    const parsed = AgentProfileDescriptor.safeParse(entry)
    if (!parsed.success) {
      continue
    }
    // The map key is authoritative; a mismatched id inside the row is corrupt.
    if (parsed.data.id !== key) {
      continue
    }
    normalized[key] = parsed.data
  }
  return normalized
}
