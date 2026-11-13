import { expect, test } from '@playwright/test'

// Smoke test for the demo mode; run with the configured browser.
test('sign-in method chooser renders with the legal footer and no signup checkboxes', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Impressum' })).toBeVisible()
  await expect(page.locator('a[href*="method=google"], a[href*="method=apple"]')).toHaveCount(2)
  await expect(page.locator('a[href*="method=email"]')).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
})
