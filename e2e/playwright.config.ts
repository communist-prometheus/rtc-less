import { defineConfig } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const fakeVideo = resolve(currentDir, 'fixtures/test-video.y4m')

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${fakeVideo}`,
        '--disable-web-security',
        '--allow-running-insecure-content',
      ],
    },
    permissions: ['camera', 'microphone'],
  },
  projects: [
    {
      name: 'webrtc',
      use: { browserName: 'chromium' },
    },
  ],
})
