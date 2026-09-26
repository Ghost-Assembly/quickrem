// What tests/docs.spec.js holds QuickRem's docs site to. The spec is shared
// across the extensions; this file is QuickRem's own.

export default {
    title: 'QuickRem',
    site: 'https://ghost-assembly.com/quickrem/',
    repo: 'https://github.com/Ghost-Assembly/quickrem',

    // [id, heading], in page order. The contents list must match.
    sections: [
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
    ],

    // README.md does not link into the site by fragment yet, so there are no
    // ids to hold it to. Drop this once it does.
    readmeLinks: false,

    // The drawing claims to be QuickRem as GNOME shows it, so it must not show
    // what the extension does not do: it adds no top bar item, and its tile is
    // never checked.
    async drawing(shot, expect) {
        await expect(shot.locator('.gtop .qm')).toHaveCount(0);
        await expect(shot.locator('.tile.on')).toHaveCount(0);
        await expect(shot.locator('.tile').first()).toContainText('Remmina');
        await expect(shot.locator('.qs-item.profile')).toHaveCount(5);
        await expect(shot.locator('.qs-head')).toContainText('5 profiles');
    },
};
