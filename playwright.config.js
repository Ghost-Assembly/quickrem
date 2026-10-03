import { defineConfig, devices } from '@playwright/test';
import project from './quick-project.json' with { type: 'json' };
const { docsPort } = project;
if (!Number.isInteger(docsPort) || docsPort < 1024 || docsPort > 65535) {
    throw new Error('docsPort must be an integer between 1024 and 65535');
}
export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.spec.js',
    fullyParallel: true,
    workers: 4,
    forbidOnly: !!process.env.CI,
    reporter: [['list']],
    use: { baseURL: `http://127.0.0.1:${docsPort}/`, trace: 'off' },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    ],
    webServer: {
        command: `python3 -m http.server ${docsPort} --bind 127.0.0.1 --directory docs`,
        url: `http://127.0.0.1:${docsPort}/`,
        reuseExistingServer: false,
        stderr: 'ignore',
    },
});
