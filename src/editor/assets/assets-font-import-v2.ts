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

    const generate = (buffer: ArrayBuffer, options: object): Promise<{ data: any; textures: Uint8Array[] }> =>
        new Promise((resolve, reject) => {
            editor.call('fonts:generate', buffer, options, (err, result) => {
                if (err || !result) {
                    reject(new Error(err ?? 'font generation failed'));
                } else {
                    resolve(result);
                }
            });
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

    const importFont = async (file: File, folder: any) => {
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
            generate(buffer, { chars: DEFAULT_CHARS, fontName: base })
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
        const generated = await generate(await response.arrayBuffer(), { chars, fontName: base, invert });
        requireSingleFontAtlas(generated.textures);
        const missing = Array.from(chars).filter((char) => !generated.data.chars[char]);
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
        importFont(file, folder).catch((err) => {
            editor.call('status:error', `Font import failed: ${err?.message ?? err}`);
        });
    });

    editor.method('fonts:reprocessV2', (font: any, chars: string, invert: boolean) => {
        const id = font.get('id');
        if (processing.has(id)) {
            return;
        }
        processing.add(id);
        reprocessFont(font, chars, invert)
            .catch((err) => {
                editor.call('status:error', `Font processing failed: ${err?.message ?? err}`);
            })
            .finally(() => processing.delete(id));
    });
});
