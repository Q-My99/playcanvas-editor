import { assembleFontData, scaleKerning } from '@playcanvas/font-tools';
import { createMsdfgenGlyphSource } from '@playcanvas/font-tools/glyph-source-msdfgen';
import { createCanvasImageBackend } from '@playcanvas/font-tools/image-backend-canvas';
import { create } from 'fontkit';

import { fontLimits, inspectFontSource, normalizeFontOptions } from '@/common/font-contract';
import { WorkerServer } from '@/core/worker/worker-server';

// fontkit's browser export reads Uint8Array directly. Keep its full GPOS pair
// behavior, including the original no-ligature/no-shaping contract.
async function browserKerning(bytes: Uint8Array, points: number[]) {
    const font = create(bytes);
    const pairs: { left: number; right: number; value: number }[] = [];
    for (const left of points) {
        for (const right of points) {
            if (left === right) continue;
            const run = font.layout(String.fromCodePoint(left, right));
            if (run.glyphs.length !== 2) continue;
            const value = run.positions[0].xAdvance - run.glyphs[0].advanceWidth;
            if (value) pairs.push({ left, right, value });
        }
    }
    return { pairs, unitsPerEm: font.unitsPerEm };
}

const whitespace = new Set([0x20, 0xa0]);
const median = (r: number, g: number, b: number) => Math.max(Math.min(r, g), Math.min(Math.max(r, g), b));
const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
};

function validateGlyph(glyph: any, size: number) {
    if (!glyph) return;
    const { bitmap, metrics } = glyph;
    assert(
        bitmap?.width === size && bitmap.height === size && bitmap.data?.length === size * size * 4,
        'Invalid MSDF glyph bitmap'
    );
    assert(
        metrics && [metrics.advance, ...metrics.translate, ...metrics.bounds, metrics.range].every(Number.isFinite),
        'Invalid MSDF glyph metrics'
    );
    assert(
        [metrics.advance, ...metrics.translate, ...metrics.bounds].every((value) => Math.abs(value) <= 1024),
        'Font glyph metrics exceed 1024 em'
    );
    assert(metrics.range > 0 && metrics.range <= 2, 'Invalid MSDF distance range');
}

function singlePageLayout(count: number, size: number, maximum: number) {
    // font-tools' generic packer may choose multiple smaller pages. This service
    // deliberately supports one immutable atlas, with a one-pixel cell gutter.
    const cell = size + 2,
        candidates = [];
    for (let width = 32; width <= maximum; width *= 2) {
        for (let height = 32; height <= width; height *= 2) {
            if (Math.floor(width / cell) * Math.floor(height / cell) >= count) candidates.push({ width, height });
        }
    }
    candidates.sort((a, b) => a.width * a.height - b.width * b.height || a.width / a.height - b.width / b.height);
    assert(candidates.length > 0, 'Font does not fit in a single 2048-pixel atlas');
    const page = candidates[0],
        columns = Math.floor(page.width / cell);
    return {
        maps: [page],
        placements: Array.from({ length: count }, (_, i) => ({
            x: 1 + (i % columns) * cell,
            y: 1 + Math.floor(i / columns) * cell,
            width: size,
            height: size,
            map: 0
        }))
    };
}

async function generate(frontendURL: string, buffer: ArrayBuffer, input: Record<string, unknown>, filename: string) {
    const bytes = new Uint8Array(buffer);
    inspectFontSource(bytes, filename);
    const options = normalizeFontOptions(input, filename),
        limits = fontLimits;
    const source = await createMsdfgenGlyphSource(bytes, {
        moduleOverrides: { locateFile: () => `${frontendURL}js/msdfgen.wasm` }
    });
    try {
        const cache = new Map();
        const glyph = (point: number) => {
            if (!cache.has(point)) {
                const value = source.generateGlyph(point, { size: options.size, pxrange: options.pxrange });
                validateGlyph(value, options.size);
                cache.set(point, value);
            }
            return cache.get(point);
        };
        // A font can contain glyphs with different outline winding. Normalize
        // each padded glyph's exterior before applying the user's invert XOR;
        // a single H/A probe otherwise makes reversed glyphs opaque rectangles.
        let automaticInvert = false;
        const present = [],
            missing = [];
        for (const point of options.codepoints) {
            const value = glyph(point);
            if (!value) {
                missing.push(String.fromCodePoint(point));
                continue;
            }
            const reversed =
                !whitespace.has(point) &&
                median(value.bitmap.data[0], value.bitmap.data[1], value.bitmap.data[2]) > 128;
            automaticInvert ||= reversed;
            if (reversed !== options.invert && !whitespace.has(point)) {
                for (let i = 0; i < value.bitmap.data.length; i += 4) {
                    value.bitmap.data[i] = 255 - value.bitmap.data[i];
                    value.bitmap.data[i + 1] = 255 - value.bitmap.data[i + 1];
                    value.bitmap.data[i + 2] = 255 - value.bitmap.data[i + 2];
                }
            }
            present.push({ point, ...value });
        }
        assert(present.length > 0, 'None of the requested characters are present in this font');
        const { maps, placements } = singlePageLayout(present.length, options.size, limits.atlasDimension);
        const png = await createCanvasImageBackend().composite({
            ...maps[0],
            glyphs: present.map((value, i) => ({ ...placements[i], bitmap: value.bitmap }))
        });
        let kerning = {};
        if (options.kerning) {
            const result = await browserKerning(
                bytes,
                present.map((value) => value.point)
            );
            assert(Number.isFinite(result.unitsPerEm) && result.unitsPerEm > 0, 'Invalid kerning units');
            assert(
                result.pairs.length <= 128 ** 2 && result.pairs.every((pair) => Number.isFinite(pair.value)),
                'Invalid kerning data'
            );
            kerning = scaleKerning(result.pairs, result.unitsPerEm);
        }
        const generated = assembleFontData({
            face: options.fontName,
            codepoints: present.map((value) => value.point),
            glyphs: present.map((value) => value.metrics),
            placements,
            maps,
            kerning,
            intensity: options.intensity,
            glyphSize: options.size
        });
        // Retain the branch's v2 numeric-key JSON contract. Engine 1.77 upgrades
        // it to character keys during its real FontHandler load.
        const data = {
            version: 2,
            type: 'msdf',
            intensity: generated.intensity,
            info: { face: generated.info.face, width: maps[0].width, height: maps[0].height, maps },
            chars: Object.fromEntries(
                Object.values(generated.chars as Record<string, any>).map((value) => [value.id, value])
            ),
            kerning: generated.kerning
        };
        const json = new TextEncoder().encode(JSON.stringify(data));
        const describe = async (value: Uint8Array) => ({
            size: value.byteLength,
            hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value))), (byte) =>
                byte.toString(16).padStart(2, '0')
            ).join('')
        });
        const manifest = {
            version: 'browser-msdf-v1',
            source: await describe(bytes),
            json: await describe(json),
            atlas: await describe(png),
            missing,
            automaticInvert
        };
        return { data, json, textures: [png], manifest };
    } finally {
        source.dispose?.();
    }
}

const workerServer = new WorkerServer(self as unknown as DedicatedWorkerGlobalScope);
workerServer.on('generate', (frontendURL, buffer, options, filename) => {
    generate(frontendURL, buffer, options ?? {}, filename ?? 'font.ttf')
        .then((result) => {
            workerServer
                .with([result.json.buffer, ...result.textures.map((texture) => texture.buffer)] as ArrayBuffer[])
                .send('generate', result);
        })
        .catch((error) => workerServer.send('error', String(error?.message ?? error).slice(0, 300)));
});
