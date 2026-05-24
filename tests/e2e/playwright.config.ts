import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  fullyParallel: false,      // run serially — shared test accounts
  retries: 1,
  workers: 1,
  reporter: [['html', { outputFolder: '../../playwright-report' }], ['list']],
  timeout: 45_000,           // per-test timeout
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'https://localhost:8444',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    permissions: ['microphone', 'camera'],
  },

  projects: [
    {
      name: 'Desktop Chrome',
      use: { 
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--no-sandbox',
            '--ignore-certificate-errors',
          ],
        },
      },
    },
    {
      name: 'Mobile Safari (iPhone 14)',
      use: { 
        ...devices['iPhone 14'],
        permissions: [],
      },
    },
    {
      name: 'Mobile Chrome (Pixel 7)',
      use: { 
        ...devices['Pixel 7'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--no-sandbox',
            '--ignore-certificate-errors',
          ],
        },
      },
    },
  ],
});
