import { expect } from 'chai';
import { describe, it } from 'mocha';

import { requireSingleFontAtlas, toFontDataV2 } from '../../../src/editor/assets/font-data-v2';

describe('font data v2 conversion', () => {
    it('converts letter-keyed v3 glyphs to codepoint-keyed v2 data', () => {
        const result = toFontDataV2({
            intensity: 0.25,
            info: { face: 'Test', maps: [{ width: 1024, height: 512 }] },
            chars: {
                A: { id: 65, letter: 'A', map: 0 },
                '😀': { id: 0x1f600, letter: '😀', map: 0 }
            },
            kerning: { 65: { 86: -1 } }
        });

        expect(result).to.deep.equal({
            version: 2,
            intensity: 0.25,
            info: {
                face: 'Test',
                width: 1024,
                height: 512,
                maps: [{ width: 1024, height: 512 }]
            },
            chars: {
                65: { id: 65, letter: 'A', map: 0 },
                128512: { id: 0x1f600, letter: '😀', map: 0 }
            },
            kerning: { 65: { 86: -1 } }
        });
    });

    it('rejects multi-page atlases', () => {
        expect(() => requireSingleFontAtlas([new Uint8Array(), new Uint8Array()])).to.throw(
            'Font generation produced 2 atlas pages'
        );
    });
});
