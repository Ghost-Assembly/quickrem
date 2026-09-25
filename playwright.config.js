import { defineConfig, devices } from '@playwright/test';

const port = 8324;

// The docs site under docs/, served exactly as GitHub Pages serves it: static
// files, no build. Chromium and Firefox only: WebKit is not supported on this
// Fedora base.
export default defineConfig({
    testDir: './tests',
    // *.spec.js is the browser suite; *.test.js is Vitest's.
    testMatch: '**/*.spec.js',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    reporter: [['list']],
    use: { baseURL: `http://127.0.0.1:${port}/`, trace: 'off' },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
    webServer: {
        command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory docs`,
        url: `http://127.0.0.1:${port}/`,
        reuseExistingServer: !process.env.CI,
        // http.server logs every request to stderr; the suite reports failures itself.
        stderr: 'ignore',
    },
});
