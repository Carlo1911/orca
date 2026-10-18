import { describe, expect, it } from 'vitest'
import { buildGenericAgentStartupPlan } from './generic-agent-startup'

const PROFILE = {
  command: '/usr/local/bin/agent',
  args: '--mode fast',
  envSet: { FOO: '1' },
  promptPolicy: 'argv' as const
}

describe('buildGenericAgentStartupPlan', () => {
  it('appends the prompt as argv and carries env', () => {
    const plan = buildGenericAgentStartupPlan({
      profile: PROFILE,
      prompt: 'hello',
      platform: 'darwin'
    })
    expect(plan?.launchCommand).toBe('/usr/local/bin/agent --mode fast hello')
    expect(plan?.env).toEqual({ FOO: '1' })
    expect(plan?.promptDelivery).toBe('argv')
  })

  it('quotes prompts with spaces', () => {
    const plan = buildGenericAgentStartupPlan({
      profile: PROFILE,
      prompt: 'hello world',
      platform: 'darwin'
    })
    expect(plan?.launchCommand).toBe('/usr/local/bin/agent --mode fast "hello world"')
  })

  it('delivers via flag or stdin-after-start', () => {
    const flag = buildGenericAgentStartupPlan({
      profile: { ...PROFILE, promptPolicy: 'flag', promptFlag: '--input' },
      prompt: 'hi there',
      platform: 'linux'
    })
    expect(flag?.launchCommand).toBe('/usr/local/bin/agent --mode fast --input "hi there"')
    const stdin = buildGenericAgentStartupPlan({
      profile: { ...PROFILE, promptPolicy: 'stdin-after-start' },
      prompt: 'hi',
      platform: 'linux'
    })
    expect(stdin?.launchCommand).toBe('/usr/local/bin/agent --mode fast')
    expect(stdin?.followupPrompt).toBe('hi')
  })

  it('rejects an empty command without inventing a fallback', () => {
    expect(
      buildGenericAgentStartupPlan({
        profile: { ...PROFILE, command: '  ' },
        prompt: '',
        platform: 'darwin'
      })
    ).toBeNull()
  })
})
