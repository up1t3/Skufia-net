import { test, expect } from '@playwright/test';

test.describe('Authentication FLow', () => {
  test('User login throws error gracefully without page reload', async ({ page }) => {
    await page.goto('https://skuf-net.ru');
    await page.waitForLoadState('networkidle');

    // Ensure Auth Modal is visible
    const authOverlay = page.locator('#auth-overlay');
    await expect(authOverlay).toBeVisible();

    // Fill Login tightly
    await page.fill('#login-username', 'e2e_tester_non_existent');
    await page.fill('#login-password', 'testpass123!');
    
    // Submit Login
    await page.click('#login-form button[type="submit"]');

    // Wait for the error message
    const errorMsg = page.locator('#login-error');
    await expect(errorMsg).not.toBeEmpty({ timeout: 10000 });
    
    // Auth overlay should STILL be visible (no reload)
    await expect(authOverlay).toBeVisible();
  });
});
