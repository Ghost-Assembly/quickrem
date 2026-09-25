// The documentation site in docs/, in real browsers.
//
// Run by `just test-docs` (Playwright, Chromium and Firefox). The rules it
// holds the page to are the Ghost Assembly docs template's: no JavaScript, no
// request to another origin, WCAG 2.2 AA in both color schemes, no sideways
// scrolling on a phone, and motion only when the reader allows it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const METADATA = fileURLToPath(new URL('../metadata.json', import.meta.url));
// METADATA is a module-relative constant, not input of any kind.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const metadata = JSON.parse(readFileSync(METADATA, 'utf8'));

const site = 'https://ghost-assembly.github.io/quickrem/';
const repo = 'https://github.com/Ghost-Assembly/quickrem';

const sections = [
    ['overview', 'Overview'],
    ['install', 'Install'],
    ['profiles', 'Profiles'],
    ['directory', 'Where profiles live'],
    ['launching', 'Launching'],
    ['preferences', 'Preferences'],
    ['security', 'Security'],
    ['architecture', 'Architecture'],
    ['testing', 'Testing'],
    ['packaging', 'Packaging'],
    ['contributing', 'Contributing'],
    ['releasing', 'Releasing'],
    ['development', 'Development'],
];

const phone = { width: 390, height: 844 };

test('loads every asset from its own origin, without errors', async ({
    page,
    baseURL,
}) => {
    const problems = [];
    page.on('console', msg => {
        if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', err => problems.push(`pageerror: ${err.message}`));
    page.on('requestfailed', req => problems.push(`failed: ${req.url()}`));
    page.on('request', req => {
        if (!req.url().startsWith(baseURL)) problems.push(`external: ${req.url()}`);
    });
    page.on('response', res => {
        if (res.status() >= 400) problems.push(`${res.status()}: ${res.url()}`);
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    expect(problems).toEqual([]);
    await expect(page).toHaveTitle('QuickRem · Ghost Assembly');
});

test('ships no JavaScript', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('script')).toHaveCount(0);
});

test('uses the self-hosted display font', async ({ page }) => {
    await page.goto('/');
    const loaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return document.fonts.check('800 84px Orbitron');
    });
    expect(loaded).toBe(true);
});

test('images and social metadata resolve', async ({ page, request }) => {
    await page.goto('/');

    const broken = await page
        .locator('img')
        .evaluateAll(imgs => imgs.filter(i => !i.naturalWidth).map(i => i.src));
    expect(broken).toEqual([]);

    // Absolute URLs point at production; check the same file locally.
    const og = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(og.startsWith(site)).toBe(true);
    expect((await request.get(og.slice(site.length))).status()).toBe(200);

    const url = await page.locator('meta[property="og:url"]').getAttribute('content');
    expect(url).toBe(site);

    for (const rel of ['icon', 'apple-touch-icon']) {
        const href = await page.locator(`link[rel="${rel}"]`).getAttribute('href');
        expect((await request.get(href)).status(), rel).toBe(200);
    }
});

// The page states facts about the project; these tie them to its own files so
// a release cannot leave the docs behind.
test.describe('agrees with metadata.json', () => {
    test('installs the real uuid', async ({ page }) => {
        await page.goto('/');
        const install = page.locator('#install');
        await expect(install).toContainText(`${metadata.uuid}.shell-extension.zip`);
        await expect(install).toContainText(`gnome-extensions enable ${metadata.uuid}`);
    });

    test('names the supported GNOME versions', async ({ page }) => {
        await page.goto('/');
        const versions = metadata['shell-version'];
        const range =
            versions.length === 1
                ? versions[0]
                : `${versions[0]}–${versions[versions.length - 1]}`;
        await expect(page.locator('.chips')).toContainText(`GNOME Shell ${range}`);
    });

    test('shows the current version', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.version')).toHaveText(
            `v${metadata['version-name']}`,
        );
    });

    test('links the real repository', async ({ page }) => {
        await page.goto('/');
        await expect(
            page.getByRole('link', { name: 'Source on GitHub' }).first(),
        ).toHaveAttribute('href', repo);
    });
});

// The drawing claims to be QuickRem as GNOME shows it, so it must not show
// what the extension does not do: it adds no top bar item, and its tile is
// never checked.
test('draws only what the extension shows', async ({ page }) => {
    await page.goto('/');
    const shot = page.locator('figure.shot');
    await expect(shot.locator('.gtop .qm')).toHaveCount(0);
    await expect(shot.locator('.tile.on')).toHaveCount(0);
    await expect(shot.locator('.tile').first()).toContainText('Remmina');
    await expect(shot.locator('.qs-item.profile')).toHaveCount(5);
    await expect(shot.locator('.qs-head')).toContainText('5 profiles');
});

test('numbers the sections in the order the contents list gives', async ({ page }) => {
    await page.goto('/');

    const found = await page
        .locator('main .section')
        .evaluateAll(els =>
            els.map(el => [
                el.id,
                el.querySelector('h2').textContent.trim(),
                el.querySelector('.kicker').textContent.trim(),
            ]),
        );
    expect(found).toEqual(
        sections.map(([id, title], i) => [id, title, String(i + 1).padStart(2, '0')]),
    );

    const listed = await page
        .locator('nav.toc ol a')
        .evaluateAll(as => as.map(a => a.getAttribute('href')));
    expect(listed).toEqual(sections.map(([id]) => `#${id}`));
});

test('in-page links land on real targets', async ({ page }) => {
    await page.goto('/');
    const targets = await page
        .locator('a[href^="#"]')
        .evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href')))]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets)
        await expect(page.locator(target), target).toHaveCount(1);
});

test('the skip link reaches the content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await expect(page.locator(await skip.getAttribute('href'))).toHaveCount(1);
});

test.describe('contents list', () => {
    test('is a sticky sidebar on a desktop', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('nav.toc')).toBeVisible();
        await expect(page.locator('details.toc-m')).toBeHidden();

        await page.locator('#releasing').scrollIntoViewIfNeeded();
        await expect(page.locator('nav.toc')).toBeInViewport();
    });

    test('folds into a disclosure on a phone', async ({ page }) => {
        await page.setViewportSize(phone);
        await page.goto('/');
        await expect(page.locator('nav.toc')).toBeHidden();

        const details = page.locator('details.toc-m');
        await expect(details).toBeVisible();
        await expect(details.getByRole('link', { name: /Install/ })).toBeHidden();

        await details.locator('summary').click();
        await expect(details.getByRole('link', { name: /Install/ })).toBeVisible();
    });
});

for (const colorScheme of ['dark', 'light']) {
    test.describe(`${colorScheme} scheme`, () => {
        test.use({ colorScheme });

        for (const [label, viewport] of [
            ['desktop', null],
            ['phone', phone],
        ]) {
            test(`has no accessibility violations on a ${label}`, async ({ page }) => {
                if (viewport) await page.setViewportSize(viewport);
                await page.goto('/');
                await page.evaluate(() => document.fonts.ready);
                const { violations } = await new AxeBuilder({ page })
                    .withTags([
                        'wcag2a',
                        'wcag2aa',
                        'wcag21aa',
                        'wcag22aa',
                        'best-practice',
                    ])
                    .analyze();
                expect(violations.map(v => `${v.id}: ${v.help}`)).toEqual([]);
            });
        }

        test('fits a 360px phone without sideways scrolling', async ({ page }) => {
            await page.setViewportSize({ width: 360, height: 800 });
            await page.goto('/');
            const overflow = await page.evaluate(
                () =>
                    document.documentElement.scrollWidth -
                    document.documentElement.clientWidth,
            );
            expect(overflow).toBeLessThanOrEqual(0);
        });

        // The logo, the hero drawing and code only read on black, so these
        // stay in the dark set whatever the reader's scheme: dark ink on a
        // near-black band.
        test('keeps the night bands dark', async ({ page }) => {
            await page.goto('/');
            for (const selector of ['.bar', '.hero', '.code', '.foot']) {
                const [ink, background] = await page
                    .locator(selector)
                    .first()
                    .evaluate(el => {
                        const style = getComputedStyle(el.closest('.night'));
                        return [style.color, style.backgroundColor];
                    });
                expect(ink, selector).toBe('rgb(236, 238, 242)');
                const channels = background.match(/\d+/g).slice(0, 3).map(Number);
                expect(Math.max(...channels), selector).toBeLessThan(16);
            }
        });
    });
}

test('follows the reader into the light scheme', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();
    await page.goto('/');
    const paper = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
    );
    expect(paper).toBe('rgb(243, 244, 248)');
    await context.close();
});

test('the halo breathes when motion is allowed', async ({ page }) => {
    await page.goto('/');
    const animations = await page.evaluate(() => document.getAnimations().length);
    expect(animations).toBeGreaterThan(0);
});

test.describe('reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('nothing animates', async ({ page }) => {
        await page.goto('/');
        const animations = await page.evaluate(() => document.getAnimations().length);
        expect(animations).toBe(0);
    });
});
