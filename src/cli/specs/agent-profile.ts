import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_PROFILE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'profile', 'list'],
    summary: 'List custom agent profiles (metadata only, never env values)',
    usage: 'orca agent profile list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca agent profile list', 'orca agent profile list --json']
  },
  {
    path: ['agent', 'profile', 'show'],
    summary: 'Show a profile descriptor without secret values',
    usage: 'orca agent profile show --id <profile-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['orca agent profile show --id claude-work']
  },
  {
    path: ['agent', 'profile', 'create'],
    summary: 'Create a custom agent profile',
    usage:
      'orca agent profile create --id <id> --label <label> --command <cmd> [--args <args>] [--base-provider <agent>] [--env-set KEY=VALUE ...] [--env-unset NAME ...] [--prompt-policy argv|flag|stdin]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'id',
      'label',
      'command',
      'args',
      'base-provider',
      'env-set',
      'env-unset',
      'prompt-policy',
      'prompt-flag'
    ],
    examples: [
      'orca agent profile create --id claude-work --label "Claude Trabajo" --command claude --env-set CLAUDE_CONFIG_DIR=/work/.claude'
    ]
  },
  {
    path: ['agent', 'profile', 'remove'],
    summary: 'Remove a profile (rejected when referenced)',
    usage: 'orca agent profile remove --id <profile-id>',
    allowedFlags: [...GLOBAL_FLAGS, 'id'],
    examples: ['orca agent profile remove --id claude-work']
  }
]
