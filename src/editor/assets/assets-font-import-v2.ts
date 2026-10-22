import type { FontGenerateResult } from '@/common/font-generation';
import { prepareFontUpload, fontBundleFields } from '@/common/font-upload';
import { config } from '@/editor/config';

import { requireSingleFontAtlas, toFontDataV2 } from './font-data-v2';

const DEFAULT_CHARS = (() => {
    let chars = '';
    for (let code = 0x20; code <= 0x7e; code++) {
        chars += String.fromCharCode(code);
    }
    return chars;
})();

editor.once('load', () => {
    const processing = new Set<number>();

    const generate = (buffer: ArrayBuffer, options: object, filename?: string): Promise<FontGenerateResult> =>
        new Promise((resolve, reject) => {
            editor.call('fonts:generate', buffer, options, (err, result) => {
                if (err || !result) {
                    reject(new Error(err ?? 'font generation failed'));
                } else {
                    resolve(result);
                }
            }, filename);
        });

    const createAsset = (data: object): Promise<number> =>
        new Promise((resolve, reject) => {
            editor.call(
                'assets:create',
                data,
                (err: string | null, id?: number) =>
                    err || id === undefined ? reject(new Error(err ?? 'asset creation failed')) : resolve(id),
                true
            );
        });

    const getObserver = (id: number) =>
        new Promise<any>((resolve) => {
            const asset = editor.call('assets:get', id);
            return asset ? resolve(asset) : editor.once(`assets:add[${id}]`, resolve);
        });

    const expectedVersion = (font: any) => ({
        uniqueId: font.get('uniqueId'), revision: font.get('revision'),
        fileHash: font.get('file.hash'), sourceHash: font.get('meta.fontPipeline.source.hash') ?? ''
    });

    editor.method('fonts:prepareUpload', (args: any) => prepareFontUpload(args, config.url.frontend, generate));

    const importFont = async (file: File, folder: any) => {
        if (config.selfhost?.fontPipeline === 'browser-msdf-v1') {
            if (!/\.(ttf|otf)$/i.test(file.name)) {
                throw new Error(
                    'The browser font pipeline supports TTF and OTF only. Font collections are not supported.'
                );
            }
            const id = await createAsset({
                name: file.name,
                type: 'font',
                file,
                filename: file.name,
                parent: folder,
                chars: DEFAULT_CHARS,
                invert: false,
                preload: true
            });
            editor.call('selector:set', 'asset', [await getObserver(id)]);
            return;
        }

        const base = file.name.replace(/\.[^.]+$/, '');
        const buffer = await file.arrayBuffer();
        const [sourceId, generated] = await Promise.all([
            createAsset({
                name: file.name,
                type: 'font',
                file,
                filename: file.name,
                parent: folder,
                noConvert: true,
                preload: false
            }),
            generate(buffer, { chars: DEFAULT_CHARS, fontName: base }, file.name)
        ]);
        requireSingleFontAtlas(generated.textures);

        const targetId = await createAsset({
            name: file.name,
            type: 'font',
            file: new File([new Uint8Array(generated.textures[0])], `${base}.png`, { type: 'image/png' }),
            filename: `${base}.png`,
            source_asset_id: String(sourceId),
            data: toFontDataV2(generated.data),
            meta: { chars: DEFAULT_CHARS, invert: false },
            parent: folder,
            noConvert: true,
            preload: true
        });

        editor.call('selector:set', 'asset', [await getObserver(targetId)]);
    };

    const reprocessFont = async (font: any, chars: string, invert: boolean) => {
        if (config.selfhost?.fontPipeline === 'browser-msdf-v1') {
            if (font.get('meta.fontPipeline.version') !== 'msdf-v1') {
                throw new Error('This font has no retained server source. Import its original TTF or OTF first.');
            }
            const expected = expectedVersion(font);
            const descriptor = structuredClone(font.get('meta.fontPipeline'));
            const branchId = editor.api.globals.branchId;
            const options = { ...descriptor.options, chars, invert, intensity: font.get('data.intensity') ?? 0 };
            const buffer = await editor.api.globals.rest.assets.assetGetSource(String(font.get('id')), expected.sourceHash, branchId);
            const generated = await generate(buffer, options, descriptor.source.filename);
            const result = await new Promise<any>((resolve, reject) => {
                editor.api.globals.rest.assets
                    .assetReimport(String(font.get('id')), {
                        ...options, intensity: undefined, branchId, fontExpected: expected,
                        ...fontBundleFields(generated, descriptor.source.filename)
                    })
                    .on('load', (_status, data) => resolve(data))
                    .on('error', (status, error) => {
                        reject(new Error(error?.message ?? error?.error ?? error ?? `Font request failed (${status})`));
                    });
            });
            if (String(result.id) !== String(font.get('id'))) {
                throw new Error('The font pipeline returned a different asset. Reload before continuing.');
            }
            // The server publishes the changed data/file/meta through ShareDB. Do not create,
            // replace, delete, or replay this snapshot as local edits: references and the current
            // observer must remain stable, including edits made while conversion was running.
            editor.emit('fonts:v2:reprocessed', font, result.meta?.fontPipeline?.missingGlyphs ?? []);
            return;
        }

        const source = editor.call('assets:get', font.get('source_asset_id'));
        const url = source?.get('file.url');
        if (!url) {
            throw new Error('font source file not found');
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`font source file could not be read (${response.status})`);
        }

        const base = font.get('name').replace(/\.[^.]+$/, '');
        const generated = await generate(await response.arrayBuffer(), { chars, fontName: base, invert }, source.get('file.filename'));
        requireSingleFontAtlas(generated.textures);
        const missing = Array.from(chars).filter((char) => !generated.data.chars[char.codePointAt(0)!]);
        const path = font.get('path') ?? [];
        const parentId = path[path.length - 1];
        const assetData: any = {
            name: font.get('name'),
            type: 'font',
            file: new File([new Uint8Array(generated.textures[0])], `${base}.png`, { type: 'image/png' }),
            filename: `${base}.png`,
            source_asset_id: String(font.get('source_asset_id')),
            data: toFontDataV2(generated.data),
            meta: { ...(font.get('meta') ?? {}), chars, invert },
            tags: font.get('tags') ?? [],
            noConvert: true,
            preload: font.get('preload')
        };
        if (parentId) {
            assetData.parent = String(parentId);
        }

        const replacement = await getObserver(await createAsset(assetData));
        const i18n = font.get('i18n');
        if (i18n && Object.keys(i18n).length > 0) {
            replacement.set('i18n', JSON.parse(JSON.stringify(i18n)));
        }
        if (font.get('exclude')) {
            replacement.set('exclude', true);
        }

        font.apiAsset.replace(replacement.apiAsset, { history: false });
        editor.call('selector:set', 'asset', [replacement]);
        await font.apiAsset.delete();
        editor.emit('fonts:v2:reprocessed', replacement, missing);
    };

    editor.method('fonts:importV2', (file: File, folder: any) => {
        return importFont(file, folder).catch((err) => {
            editor.call('status:error', `Font import failed: ${err?.message ?? err}`);
        });
    });

    editor.method('fonts:isProcessing', (id: number) => processing.has(id));

    editor.method('fonts:reprocessV2', (font: any, chars: string, invert: boolean) => {
        const id = font.get('id');
        if (processing.has(id)) {
            return;
        }
        processing.add(id);
        editor.emit('fonts:v2:processing', font);
        return reprocessFont(font, chars, invert)
            .catch((err) => {
                editor.call('status:error', `Font processing failed: ${err?.message ?? err}`);
            })
            .finally(() => {
                processing.delete(id);
                editor.emit('fonts:v2:processing', font);
            });
    });
});
