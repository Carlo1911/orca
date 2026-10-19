import { useState } from 'react'
import type {
  AgentLaunchSettings,
  AgentLaunchSettingsMutation
} from '../../../../shared/agent-launch-settings'
import type {
  AgentProfileDescriptor,
  AgentProfileSummary
} from '../../../../shared/agent-launch-profile'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { translate } from '@/i18n/i18n'

export function AgentProfileSection({
  settings,
  mutate,
  ownerHostId
}: {
  settings: AgentLaunchSettings
  mutate: (mutation: AgentLaunchSettingsMutation) => Promise<void>
  /** Execution host that owns profiles created here; preserved on edit. */
  ownerHostId: string
}): React.JSX.Element {
  const profiles = Object.values(settings.agentProfiles ?? {})
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async (mutation: AgentLaunchSettingsMutation): Promise<void> => {
    setError(null)
    try {
      await mutate(mutation)
      setEditingId(null)
      setConfirmingDelete(null)
    } catch {
      // The mutation tail surfaces save state; the editor stays open with the draft.
      setError(
        translate(
          'settings.agents.profileSaveFailed',
          'Couldn’t save the profile. Check the host connection and try again.'
        )
      )
    }
  }

  return (
    <section aria-label={translate('settings.agents.profiles', 'Custom profiles')}>
      <h3 className="text-sm font-semibold text-foreground">
        {translate('settings.agents.profiles', 'Custom profiles')}
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {translate(
          'settings.agents.profilesDescription',
          'Launch entries with their own command, args, and environment. Two profiles may share one executable.'
        )}
      </p>
      {profiles.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {translate('settings.agents.noProfiles', 'No custom profiles yet.')}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {profiles.map((profile) => {
            return (
              <li
                key={profile.id}
                className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{profile.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {profile.command} {profile.args}
                    {profile.baseProvider ? ` · ${profile.baseProvider}` : ''}
                    {profile.envNames.length > 0 ? ` · ${profile.envNames.length} env` : ''}
                    {!profile.enabled
                      ? ` · ${translate('settings.agents.profileDisabled', 'disabled')}`
                      : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingId(profile.id)}
                >
                  {translate('settings.agents.editProfile', 'Edit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    // Duplicate carries no secrets: env values stay in the sealed recipe.
                    // The new profile starts with an empty env; edit it via CLI for now.
                    const copy: AgentProfileDescriptor = {
                      id: `${profile.id}-copy`,
                      label: `${profile.label} (copy)`,
                      ownerHostId,
                      baseProvider: profile.baseProvider,
                      enabled: true,
                      revisionId: `rev-${Date.now().toString(36)}`,
                      command: profile.command,
                      args: profile.args,
                      envSet: {},
                      envUnset: [],
                      promptPolicy: profile.promptPolicy
                    }
                    void save({ type: 'profile-create', profile: copy })
                  }}
                >
                  {translate('settings.agents.duplicateProfile', 'Duplicate')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setConfirmingDelete(profile.id)}
                >
                  {translate('settings.agents.deleteProfile', 'Delete')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditingId('new')}>
          {translate('settings.agents.newProfile', 'New profile')}
        </Button>
      </div>
      {editingId !== null ? (
        <AgentProfileEditor
          initial={editingId === 'new' ? null : (settings.agentProfiles?.[editingId] ?? null)}
          onCancel={() => setEditingId(null)}
          onSave={(profile) => save({ type: 'profile-create', profile })}
          ownerHostId={ownerHostId}
        />
      ) : null}
      {confirmingDelete !== null ? (
        <div
          role="alertdialog"
          aria-label="confirm delete"
          className="mt-3 rounded-md border border-destructive/50 px-3 py-2"
        >
          <p className="text-sm text-foreground">
            {translate(
              'settings.agents.deleteProfileConfirm',
              'Delete this profile? Sessions already running keep their recipe.'
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => save({ type: 'profile-remove', id: confirmingDelete })}
            >
              {translate('settings.agents.deleteProfile', 'Delete')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(null)}
            >
              {translate('settings.agents.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function AgentProfileEditor({
  initial,
  onCancel,
  onSave,
  ownerHostId
}: {
  initial: AgentProfileSummary | null
  onCancel: () => void
  onSave: (profile: AgentProfileDescriptor) => Promise<void>
  ownerHostId: string
}): React.JSX.Element {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState(initial?.args ?? '')
  const [invalid, setInvalid] = useState<string | null>(null)

  const submit = (): void => {
    if (!label.trim() || !command.trim()) {
      setInvalid(translate('settings.agents.profileRequired', 'A name and command are required.'))
      return
    }
    setInvalid(null)
    const id =
      initial?.id ??
      (label
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '') ||
        `profile-${Date.now().toString(36)}`)
    const payload: AgentProfileDescriptor = {
      id,
      label: label.trim(),
      ownerHostId: initial?.ownerHostId ?? ownerHostId,
      baseProvider: initial?.baseProvider ?? null,
      enabled: initial?.enabled ?? true,
      revisionId: initial?.revisionId ?? `rev-${Date.now().toString(36)}`,
      command: command.trim(),
      args,
      envSet: {},
      envUnset: [],
      promptPolicy: initial?.promptPolicy ?? 'argv'
    }
    void onSave(initial ? { ...payload, id: initial.id } : payload)
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border/50 px-3 py-3">
      <div>
        <label htmlFor="profile-label" className="text-xs font-medium text-foreground">
          {translate('settings.agents.profileName', 'Name')}
        </label>
        <Input
          id="profile-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          aria-invalid={invalid !== null}
        />
      </div>
      <div>
        <label htmlFor="profile-command" className="text-xs font-medium text-foreground">
          {translate('settings.agents.profileCommand', 'Command')}
        </label>
        <Input
          id="profile-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          aria-invalid={invalid !== null}
          placeholder="claude"
        />
      </div>
      <div>
        <label htmlFor="profile-args" className="text-xs font-medium text-foreground">
          {translate('settings.agents.profileArgs', 'Arguments (optional)')}
        </label>
        <Input id="profile-args" value={args} onChange={(event) => setArgs(event.target.value)} />
      </div>
      {invalid ? (
        <p role="alert" className="text-xs text-destructive">
          {invalid}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit}>
          {translate('settings.agents.saveProfile', 'Save profile')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {translate('settings.agents.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}
