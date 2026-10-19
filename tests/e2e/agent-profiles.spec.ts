import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

async function openAgentsSettings(page: Parameters<typeof waitForSessionReady>[0]): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'agents', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.getByLabel('Custom profiles')).toBeVisible({ timeout: 10_000 })
}

async function profileCount(page: Parameters<typeof waitForSessionReady>[0]): Promise<number> {
  return page.evaluate(
    () => Object.keys(window.__store!.getState().settings.agentProfiles ?? {}).length
  )
}

test.describe('Agent profiles', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
  })

  test('create, persist across restart, and delete', async ({ orcaPage }) => {
    await openAgentsSettings(orcaPage)
    const before = await profileCount(orcaPage)

    await orcaPage.getByRole('button', { name: 'New profile' }).click()
    await orcaPage.locator('#profile-label').fill(`E2E Profile ${Date.now()}`)
    await orcaPage.locator('#profile-command').fill('e2e-agent')
    await orcaPage.getByRole('button', { name: 'Save profile' }).click()

    await expect.poll(() => profileCount(orcaPage), { timeout: 10_000 }).toBe(before + 1)

    // Profile survives a full app restart (settings persist to disk).
    await orcaPage.reload()
    await waitForSessionReady(orcaPage)
    await expect.poll(() => profileCount(orcaPage), { timeout: 15_000 }).toBe(before + 1)

    // Delete returns the list to its original size.
    await openAgentsSettings(orcaPage)
    const profileRow = orcaPage.locator('li', { hasText: 'E2E Profile' }).first()
    await profileRow.getByRole('button', { name: 'Delete' }).click()
    await orcaPage.getByRole('button', { name: 'Delete' }).last().click()
    await expect.poll(() => profileCount(orcaPage), { timeout: 10_000 }).toBe(before)
  })

  test('requires name and command', async ({ orcaPage }) => {
    await openAgentsSettings(orcaPage)
    await orcaPage.getByRole('button', { name: 'New profile' }).click()
    await orcaPage.getByRole('button', { name: 'Save profile' }).click()
    await expect(orcaPage.getByRole('alert')).toBeVisible({ timeout: 10_000 })
  })
})
