import { describe, expect, it } from 'vitest'
import { ProtectedSecretPersistence } from './protected-secret-persistence'
import { AgentLaunchProfileStore, profileRecipeSlot } from './agent-launch-profile-store'
import { _resetSecretStoreForTests, setSecretStore } from '../shared/secret-store'

function sealingStore() {
  _resetSecretStoreForTests()
  setSecretStore({
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(`sealed:${plaintext}`),
    decryptString: (cipher: Buffer) => cipher.toString().replace(/^sealed:/, ''),
    describeProtectionGap: () => null
  })
  const protection = new ProtectedSecretPersistence()
  const sealed = new Map<string, string>()
  const store = new AgentLaunchProfileStore({
    seal: (slot: string, plaintext: string) => {
      const encrypted = protection.encrypt(slot, plaintext)
      if (encrypted.blob) {
        sealed.set(slot, encrypted.blob)
      }
      return { blob: encrypted.blob, degraded: encrypted.degraded }
    }
  })
  return { store, sealed }
}

function unavailableStore() {
  _resetSecretStoreForTests()
  setSecretStore({
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('unavailable')
    },
    decryptString: () => '',
    describeProtectionGap: () => 'unavailable'
  })
  const protection = new ProtectedSecretPersistence()
  return new AgentLaunchProfileStore({
    seal: (slot: string, plaintext: string) => {
      const encrypted = protection.encrypt(slot, plaintext)
      return { blob: encrypted.blob, degraded: encrypted.degraded }
    }
  })
}

const BASE = {
  label: 'Claude Trabajo',
  ownerHostId: 'host-1',
  baseProvider: 'claude' as const,
  command: 'claude',
  envSet: { CLAUDE_CONFIG_DIR: '/work/.claude' }
}

describe('agent-launch-profile-store', () => {
  it('creates two profiles on the same executable and lists summaries without secrets', () => {
    const { store, sealed } = sealingStore()
    const personal = store.create({ ...BASE, id: 'personal', envSet: {} })
    const work = store.create({ ...BASE, id: 'work' })
    if (!('id' in personal) || !('id' in work)) {
      throw new Error('expected profiles')
    }
    expect(personal.command).toBe(work.command)
    expect(personal.id).not.toBe(work.id)
    const summaries = store.list()
    expect(summaries.map((summary) => summary.id)).toEqual(['personal', 'work'])
    expect(summaries[1]?.envNames).toEqual(['CLAUDE_CONFIG_DIR'])
    expect(JSON.stringify(summaries)).not.toContain('/work/.claude')
    const blob = sealed.get(profileRecipeSlot('work'))
    expect(blob).toBeDefined()
    expect(blob).not.toContain('/work/.claude')
  })

  it('edits mint a new revision and keep the prior revision resolvable', () => {
    const { store } = sealingStore()
    const created = store.create({ ...BASE, id: 'p1' })
    if (!('id' in created)) {
      throw new Error('expected profile')
    }
    const before = created.revisionId
    store.retain(before, 'session-1')
    const updated = store.update('p1', { envSet: { CLAUDE_CONFIG_DIR: '/other' } })
    if (!('id' in updated)) {
      throw new Error('expected profile')
    }
    expect(updated.revisionId).not.toBe(before)
    // The prior revision stays pinned by the retained session.
    expect(store.revisionFor('p1')).toBe(updated.revisionId)
  })

  it('rejects duplicates, unknown edits, and invalid input', () => {
    const { store } = sealingStore()
    expect(store.create({ ...BASE, id: 'p1' })).toMatchObject({ id: 'p1' })
    expect(store.create({ ...BASE, id: 'p1' })).toEqual({ kind: 'duplicate' })
    expect(store.update('missing', { label: 'x' })).toEqual({ kind: 'missing' })
    expect(store.create({ ...BASE, id: 'bad id!' })).toMatchObject({ kind: 'invalid' })
  })

  it('seal failure publishes nothing and keeps the prior revision', () => {
    const store = unavailableStore()
    expect(store.create({ ...BASE, id: 'p1' })).toMatchObject({ kind: 'seal-failed' })
    expect(store.get('p1')).toBeNull()
    expect(store.list()).toEqual([])
  })

  it('remove with references is rejected; free profiles release sealed payloads', () => {
    const { store } = sealingStore()
    store.create({ ...BASE, id: 'p1' })
    expect(store.remove('p1', () => ['automation-1'])).toEqual({
      kind: 'referenced',
      references: ['automation-1']
    })
    expect(store.get('p1')).not.toBeNull()
    expect(store.remove('p1', () => [])).toBe(true)
    expect(store.get('p1')).toBeNull()
  })

  it('releasing the last reference frees the old sealed payload', () => {
    const { store, sealed } = sealingStore()
    const created = store.create({ ...BASE, id: 'p1' })
    if (!('id' in created)) {
      throw new Error('expected profile')
    }
    store.retain(created.revisionId, 'session-1')
    const updated = store.update('p1', { command: 'claude-new' })
    if (!('id' in updated)) {
      throw new Error('expected profile')
    }
    store.release(created.revisionId, 'session-1')
    expect(sealed.get(profileRecipeSlot('p1'))).toBeDefined()
    expect(store.revisionFor('p1')).toBe(updated.revisionId)
  })
})
