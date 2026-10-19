import { isAgentSessionRewindRecord } from './agent-session-rewind'
import { isAgentSessionLaunchArgs } from './agent-session-launch-args'
import { isAgentSessionConversationName } from './agent-session-conversation-name'
import { isAgentSessionProfileRef } from './agent-session-profile-ref'
import {
  isPersistedAgentSessionHandoffStage,
  isPersistedAgentSessionRuntimeKind,
  type PersistedAgentSessionLease,
  type PersistedAgentSessionRecord
} from './agent-session-legacy-handoff-lease'
import { isAgentSessionConversationCommandRecord } from './agent-session-conversation-command'
import { decodePersistedAgentSessionProviderHandleChain } from './agent-session-provider-handle'
import { isAgentSessionProviderContextBoundary } from './agent-session-provider-context'
import { isStructuredAgentId } from './agent-session-provider-handle-encoding'
import { isAgentSessionAccountHome, MAX_PATH_LENGTH } from './agent-session-account-home'
import {
  AGENT_SESSION_RECORD_SCHEMA_VERSION,
  isAgentSessionExecutionLocation,
  isAgentSessionId,
  isAgentSessionOptions,
  isAgentSessionProcessIdentity,
  isBoundedString,
  MAX_AGENT_SESSION_DEATH_DETAIL_CHARS,
  MAX_ID_LENGTH,
  type AgentSessionJournalCheckpoint,
  type AgentSessionDeathEvidence,
  type AgentSessionLease,
  type AgentSessionRecord
} from './agent-session-record'

function isAgentSessionJournalCheckpoint(value: unknown): value is AgentSessionJournalCheckpoint {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const checkpoint = value as Partial<AgentSessionJournalCheckpoint>
  return (
    Number.isSafeInteger(checkpoint.epoch) &&
    (checkpoint.epoch as number) >= 0 &&
    Number.isSafeInteger(checkpoint.sequence) &&
    (checkpoint.sequence as number) >= 0
  )
}

function isAgentSessionDeathEvidence(value: unknown): value is AgentSessionDeathEvidence {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const evidence = value as Partial<AgentSessionDeathEvidence>
  const { observedAt, lastProvenAliveAt, ownerFence, runtimeEnd } = evidence
  return (
    (evidence.kind === 'exit-observed' ||
      evidence.kind === 'pid-absent' ||
      evidence.kind === 'identity-mismatch') &&
    isBoundedString(evidence.detail, MAX_AGENT_SESSION_DEATH_DETAIL_CHARS) &&
    typeof observedAt === 'number' &&
    Number.isSafeInteger(observedAt) &&
    observedAt >= 0 &&
    (ownerFence === undefined || (Number.isSafeInteger(ownerFence) && ownerFence >= 0)) &&
    (lastProvenAliveAt === undefined ||
      (Number.isSafeInteger(lastProvenAliveAt) &&
        lastProvenAliveAt >= 0 &&
        lastProvenAliveAt <= observedAt)) &&
    (runtimeEnd === undefined || isBoundedString(runtimeEnd, MAX_ID_LENGTH))
  )
}

function isPersistedAgentSessionLease(value: unknown): value is PersistedAgentSessionLease {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const lease = value as Partial<AgentSessionLease>
  return (
    isAgentSessionId(lease.sessionId) &&
    isPersistedAgentSessionRuntimeKind(lease.runtimeKind) &&
    Number.isSafeInteger(lease.runtimeFence) &&
    (lease.runtimeFence as number) >= 0 &&
    (lease.handoffStage === null || isPersistedAgentSessionHandoffStage(lease.handoffStage)) &&
    (lease.provenHandleLinkId === null || isBoundedString(lease.provenHandleLinkId, 128)) &&
    (lease.ownerProcess === null || isAgentSessionProcessIdentity(lease.ownerProcess)) &&
    (lease.reservedSpawnToken === null ||
      isBoundedString(lease.reservedSpawnToken, MAX_ID_LENGTH)) &&
    Number.isSafeInteger(lease.leaseDeadlineAt) &&
    Number.isSafeInteger(lease.lastRenewedAt) &&
    (lease.handoffOperationId === null ||
      isBoundedString(lease.handoffOperationId, MAX_ID_LENGTH)) &&
    (lease.journalCheckpoint === null ||
      isAgentSessionJournalCheckpoint(lease.journalCheckpoint)) &&
    isBoundedString(lease.claimKeyId, MAX_ID_LENGTH) &&
    (lease.claimStatus === 'reserved' ||
      lease.claimStatus === 'live' ||
      lease.claimStatus === 'conflicted' ||
      lease.claimStatus === 'released') &&
    typeof lease.unreconciled === 'boolean' &&
    (lease.deathEvidence === null || isAgentSessionDeathEvidence(lease.deathEvidence))
  )
}

/** Stored identity is independent of registrations; availability is checked only at start. */
export function isPersistedAgentSessionRecord(
  value: unknown
): value is PersistedAgentSessionRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Partial<AgentSessionRecord>
  const fieldsValid =
    record.schemaVersion === AGENT_SESSION_RECORD_SCHEMA_VERSION &&
    isAgentSessionId(record.sessionId) &&
    isAgentSessionExecutionLocation(record.location) &&
    isStructuredAgentId(record.provider) &&
    isAgentSessionAccountHome(record.accountHome) &&
    (record.launchDirectory === undefined ||
      isBoundedString(record.launchDirectory, MAX_PATH_LENGTH)) &&
    (record.options === undefined || isAgentSessionOptions(record.options)) &&
    (record.permissionMode === undefined ||
      isBoundedString(record.permissionMode, MAX_ID_LENGTH)) &&
    (record.rewind === undefined || isAgentSessionRewindRecord(record.rewind)) &&
    (record.providerContextBoundary === undefined ||
      isAgentSessionProviderContextBoundary(record.providerContextBoundary)) &&
    (record.conversationCommand === undefined ||
      isAgentSessionConversationCommandRecord(record.conversationCommand)) &&
    (record.conversationName === undefined ||
      isAgentSessionConversationName(record.conversationName)) &&
    (record.launchArgs === undefined || isAgentSessionLaunchArgs(record.launchArgs)) &&
    (record.profile === undefined || isAgentSessionProfileRef(record.profile)) &&
    !Object.hasOwn(record, 'launchEnv') &&
    isPersistedAgentSessionLease(record.lease) &&
    record.lease.sessionId === record.sessionId &&
    Number.isSafeInteger(record.createdAt) &&
    Number.isSafeInteger(record.updatedAt)
  if (!fieldsValid) {
    return false
  }
  const validated = record as AgentSessionRecord
  // The row holds stored handles; validate the chain they decode to.
  const chain = decodePersistedAgentSessionProviderHandleChain(validated.providerHandleChain)
  const head = chain?.at(-1)
  return (
    chain !== null &&
    // Chain validation already enforces one namespace.
    (!head || head.handle.agent === validated.provider) &&
    (validated.providerContextBoundary === undefined ||
      validated.providerContextBoundary.afterFence <= validated.lease.runtimeFence) &&
    (validated.lease.claimStatus !== 'live' ||
      (validated.lease.ownerProcess !== null &&
        // Null: the owner's process is live and its provider has not answered with a handle yet.
        (validated.lease.provenHandleLinkId === null ||
          (head?.linkId === validated.lease.provenHandleLinkId &&
            head.mintedAtFence === validated.lease.runtimeFence))))
  )
}
