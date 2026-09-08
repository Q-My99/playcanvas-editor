import { expect } from 'chai';
import { describe, it } from 'mocha';

import { Schema } from '../../src/editor-api/schema';

describe('asset type catalog compatibility', () => {
    const types = ['audio', 'container', 'material', 'scene', 'texture', 'textureatlas', 'template'];
    const typeField = { type: 'string', enum: types };

    const createSchema = (type: Record<string, unknown>) =>
        new Schema({
            version: 1,
            documents: {
                asset: { type: 'object', properties: { type } },
                scene: { type: 'object', properties: {} },
                settings: { type: 'object', properties: {} }
            },
            // File-only and source types have no entry here, but still need inspectors.
            assetData: {
                texture: { type: 'object', properties: {} }
            }
        });

    it('reads a direct enum', () => {
        expect(createSchema(typeField).getAssetTypes()).to.deep.equal(types);
    });

    it('reads the hosted nullable enum without losing file-only or source types', () => {
        expect(
            createSchema({
                anyOf: [typeField, { type: 'null' }],
                readOnly: true
            }).getAssetTypes()
        ).to.deep.equal(types);
    });

    it('reads the enum when the null branch comes first', () => {
        expect(
            createSchema({
                anyOf: [{ type: 'null' }, typeField]
            }).getAssetTypes()
        ).to.deep.equal(types);
    });

    it('returns an empty list when the type field has no enum', () => {
        expect(createSchema({ type: 'string' }).getAssetTypes()).to.deep.equal([]);
    });
});
