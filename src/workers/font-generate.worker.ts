import { GLYPH_SIZE, PXRANGE, generateFont } from '@playcanvas/font-tools';
import { createMsdfgenGlyphSource } from '@playcanvas/font-tools/glyph-source-msdfgen';
import { createCanvasImageBackend } from '@playcanvas/font-tools/image-backend-canvas';

import { WorkerServer } from '@/core/worker/worker-server';

const workerServer = new WorkerServer(self as unknown as DedicatedWorkerGlobalScope);

type Options = {
    chars?: string;
    fontName?: string;
    intensity?: number;
    invert?: boolean;
    size?: number;
    pxrange?: number;
};

const PROBE_CHARS = 'HXAoe';
const median = (r: number, g: number, b: number) => Math.max(Math.min(r, g), Math.min(Math.max(r, g), b));

const isInverted = (glyphSource: any, size: number, pxrange: number) => {
    for (const ch of PROBE_CHARS) {
        const glyph = glyphSource.generateGlyph(ch.codePointAt(0), { size, pxrange });
        if (glyph) {
            const pixels = glyph.bitmap.data;
            return median(pixels[0], pixels[1], pixels[2]) > 128;
        }
    }
    return false;
};

const generate = async (frontendURL: string, buffer: ArrayBuffer, options: Options) => {
    const glyphSource = await createMsdfgenGlyphSource(new Uint8Array(buffer), {
        moduleOverrides: { locateFile: () => `${frontendURL}js/msdfgen.wasm` }
    });
    const invert =
        isInverted(glyphSource, options.size ?? GLYPH_SIZE, options.pxrange ?? PXRANGE) !== Boolean(options.invert);
    const { data, textures } = await generateFont({
        chars: options.chars,
        fontName: options.fontName,
        intensity: options.intensity,
        invert,
        size: options.size,
        pxrange: options.pxrange,
        glyphSource,
        imageBackend: createCanvasImageBackend()
    });
    glyphSource.dispose?.();
    workerServer.with(textures.map((texture) => texture.buffer as ArrayBuffer)).send('generate', data, textures);
};

workerServer.on('generate', (frontendURL, buffer, options) => {
    generate(frontendURL, buffer, options ?? {}).catch((err) =>
        workerServer.send('error', String(err?.message ?? err))
    );
});
