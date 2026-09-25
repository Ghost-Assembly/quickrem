import { describe, expect, it } from 'vitest';

import { readGroup } from '../modules/keyfile.js';

const all = () => true;

describe('readGroup', () => {
    it('reads one group and nothing outside it', () => {
        const fields = readGroup('a=0\n[g]\na=1\n[h]\na=2\n', 'g', all);

        expect([...fields]).toEqual([['a', '1']]);
    });

    it('merges a group that appears twice, the later key winning', () => {
        const fields = readGroup('[g]\na=1\nb=1\n[h]\n[g]\na=2\n', 'g', all);

        expect(Object.fromEntries(fields)).toEqual({ a: '2', b: '1' });
    });

    it('compares keys exactly, after trimming around them', () => {
        const fields = readGroup('[g]\n  key  =  v\nkey2=w\nkey[de]=x\n', 'g', all);

        expect(Object.fromEntries(fields)).toEqual({
            key: 'v',
            key2: 'w',
            'key[de]': 'x',
        });
    });

    it('never reads a key the caller did not keep', () => {
        const fields = readGroup(
            '[g]\nsecret=KEY\nname=n\n',
            'g',
            key => key !== 'secret',
        );

        expect([...fields.keys()]).toEqual(['name']);
    });

    it('resolves escapes in one pass', () => {
        const fields = readGroup(
            String.raw`[g]
a=\sx\ty\nz\r
b=back\\slash
c=not\\s-a-space
d=unknown\q`,
            'g',
            all,
        );

        expect(fields.get('a')).toBe(' x\ty\nz\r');
        expect(fields.get('b')).toBe('back\\slash');
        expect(fields.get('c')).toBe('not\\s-a-space');
        expect(fields.get('d')).toBe('unknown\\q');
    });

    it('skips comments, blank lines and lines with no key', () => {
        const fields = readGroup(
            '[g]\n# c\n; c\n\n=orphan\nnoequals\nk=v=w\n',
            'g',
            all,
        );

        expect(Object.fromEntries(fields)).toEqual({ k: 'v=w' });
    });

    it('returns nothing for text that is not a string', () => {
        expect(readGroup(undefined, 'g', all).size).toBe(0);
    });
});
