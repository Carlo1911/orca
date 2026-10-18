import { describe, expect, it } from 'vitest'
import { normalizeAgentProfiles } from './agent-launch-profile-normalize'

const VALID = {
  id: 'p1',
  label: 'P1',
  ownerHostId: 'host-1',
  baseProvider: 'claude',
  enabled: true,
  revisionId: 'rev-1',
  command: 'claude',
  args: '',
  envSet: { A: '1' },
  envUnset: [],
  promptPolicy: 'argv'
}

describe('normalizeAgentProfiles', () => {
  it('keeps valid rows keyed by id', () => {
    expect(normalizeAgentProfiles({ p1: VALID })).toEqual({ p1: VALID })
  })

  it('drops malformed rows, id mismatches, and non-objects without failing', () => {
    expect(normalizeAgentProfiles(undefined)).toEqual({})
    expect(normalizeAgentProfiles(null)).toEqual({})
    expect(normalizeAgentProfiles([])).toEqual({})
    expect(
      normalizeAgentProfiles({
        p1: VALID,
        bad: { ...VALID, id: 'p1', command: '' },
        mismatch: { ...VALID, id: 'other' },
        nul: { ...VALID, id: 'nul', command: 'a\0b' }
      })
    ).toEqual({ p1: VALID })
  })
})
