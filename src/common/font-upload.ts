import { fontLimits } from './font-contract';
import { generateFont } from './font-generation';
import type { FontGenerateResult } from './font-generation';

/** Shared by the Editor Caller uploader and the editor-api uploader. */
export const prepareFontUpload = async (
    args: Record<string, any>,
    frontendURL: string,
    generate: (
        buffer: ArrayBuffer,
        options: Record<string, unknown>,
        filename: string
    ) => Promise<FontGenerateResult> = (buffer, options, filename) =>
        generateFont(frontendURL, buffer, options, filename)
) => {
    const file: File = args.file;
    if (!/\.(ttf|otf)$/i.test(file.name))
        throw new Error('The browser font pipeline supports TTF and OTF only. Font collections are not supported.');
    if (file.size > fontLimits.sourceBytes) throw new Error('Font sources are limited to 4 MiB');
    const asset = args.asset;
    const expected = asset
        ? {
              uniqueId: asset.get('uniqueId'),
              revision: asset.get('revision'),
              fileHash: asset.get('file.hash'),
              sourceHash: asset.get('meta.fontPipeline.source.hash') ?? ''
          }
        : undefined;
    const options = { ...(asset?.get('meta.fontPipeline.options') ?? {}) };
    if (asset) options.intensity = asset.get('data.intensity') ?? 0;
    for (const key of ['chars', 'fontName', 'intensity', 'invert', 'size', 'pxrange', 'kerning']) {
        if (args[key] !== undefined) options[key] = args[key];
    }
    const generated = await generate(await file.arrayBuffer(), options, file.name);
    return {
        ...args,
        filename: file.name,
        ...options,
        intensity: args.intensity,
        ...fontBundleFields(generated, file.name),
        fontExpected: expected
    };
};

export const fontBundleFields = (generated: FontGenerateResult, filename: string) => {
    if (generated.textures.length !== 1) throw new Error('Font generation must produce exactly one atlas page');
    const base = filename.replace(/\.[^.]+$/, '');
    return {
        fontJson: new File([new Uint8Array(generated.json)], `${base}.json`, { type: 'application/json' }),
        fontAtlas: new File([new Uint8Array(generated.textures[0])], `${base}.png`, { type: 'image/png' }),
        fontManifest: generated.manifest
    };
};
