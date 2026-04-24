import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  fullyParallel: false,      // run serially — shared test accounts
  retries: 1,
  workers: 1,
  reporter: [['html', { outputFolder: '../../test-results/playwright-report' }], ['list']],
  timeout: 45_000,           // per-test timeout
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'https://skuf-net.ru',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Fake mic/camera for voice & call tests
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--no-sandbox',
      ],
    },
    permissions: ['microphone', 'camera'],
  },

  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Safari (iPhone 14)',
      use: { ...devices['iPhone 14'] },
    },
  ],
});
