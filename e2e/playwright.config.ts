import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'webrtc-nat',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--disable-web-security',
            '--allow-running-insecure-content',
          ],
        },
      },
    },
  ],
})
