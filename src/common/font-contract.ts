/** Shared browser/server font limits and SFNT preflight. No rendering or Node dependencies. */
class FontBytes extends Uint8Array {
    private view() {
        return new DataView(this.buffer, this.byteOffset, this.byteLength);
    }
    readUInt16BE(at: number) {
        return this.view().getUint16(at);
    }
    readInt16BE(at: number) {
        return this.view().getInt16(at);
    }
    readUInt32BE(at: number) {
        return this.view().getUint32(at);
    }
    readInt32BE(at: number) {
        return this.view().getInt32(at);
    }
    readUIntBE(at: number, size: number) {
        let value = 0;
        for (let i = 0; i < size; i++) value = value * 256 + this[at + i];
        return value;
    }
    ascii(start = 0, end = this.length) {
        return String.fromCharCode(...this.subarray(start, end));
    }
    subarray(start: number, end = this.length): FontBytes {
        const bytes = super.subarray(start, end);
        return new FontBytes(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
}

export const fontLimits = Object.freeze({
    sourceBytes: 4 * 1024 * 1024,
    jsonBytes: 1024 * 1024,
    atlasBytes: 20 * 1024 * 1024,
    sourceGlyphs: 8192,
    characters: 512,
    characterBytes: 4096,
    atlasDimension: 2048,
    tables: 64,
    glyphPoints: 8192,
    glyphContours: 1024,
    compositeComponents: 64,
    compositeDepth: 16,
    workerMilliseconds: 20000,
    activeWorkers: 2
});
export const defaultFontChars = Array.from({ length: 95 }, (_, i) => String.fromCodePoint(i + 32)).join('');
const fail = (message: string, status = 422) => Object.assign(new Error(message), { status });
const hasControl = (value: string) => Array.from(value).some((char) => char.charCodeAt(0) < 32);
const colorTables = ['COLR', 'CPAL', 'CBDT', 'CBLC', 'sbix', 'SVG ', 'EBDT', 'EBLC', 'EBSC'];
const variationTables = ['fvar', 'gvar', 'avar', 'cvar', 'HVAR', 'VVAR', 'MVAR', 'CFF2'];

/**
 * Validate the bounded, standalone SFNT subset before sending bytes to FreeType.
 * This is structural preflight, not a general font conformance validator.
 */
export function inspectFontSource(input: Uint8Array, filename: string) {
    if (!(input instanceof Uint8Array) || input.length > fontLimits.sourceBytes)
        throw fail('Font sources are limited to 4 MiB');
    const bytes = new FontBytes(input);
    if (
        typeof filename !== 'string' ||
        filename.length > 255 ||
        filename.includes('/') ||
        filename.includes('\\') ||
        hasControl(filename)
    )
        throw fail('A plain font filename is required');
    if (/\.(ttc|dfont)$/i.test(filename) || bytes.subarray(0, 4).ascii() === 'ttcf')
        throw fail('Font collections (TTC) and dfont suitcases are not supported');
    if (!/\.(ttf|otf)$/i.test(filename)) throw fail('Font conversion supports standalone .ttf and .otf sources only');
    if (bytes.length < 12) throw fail('Font SFNT header is truncated');
    const signature = bytes.readUInt32BE(0);
    const format = signature === 0x00010000 ? 'ttf' : signature === 0x4f54544f ? 'otf' : null;
    if (!format) throw fail('Unsupported font signature; expected TrueType or OpenType SFNT');
    if (!filename.toLowerCase().endsWith(`.${format}`))
        throw fail('Font extension does not match its SFNT outline format');
    const count = bytes.readUInt16BE(4),
        directoryEnd = 12 + count * 16;
    if (!count || count > fontLimits.tables || directoryEnd > bytes.length)
        throw fail('Font table directory is invalid or exceeds 64 tables');
    const tables = new Map<string, FontBytes>(),
        spans = [];
    for (let i = 0; i < count; i++) {
        const at = 12 + i * 16,
            tag = bytes.ascii(at, at + 4);
        const offset = bytes.readUInt32BE(at + 8),
            length = bytes.readUInt32BE(at + 12);
        if (tables.has(tag)) throw fail('Font contains duplicate SFNT tables');
        if (offset < directoryEnd || offset % 4 !== 0 || offset + length > bytes.length)
            throw fail('Font table extends outside its source or has an invalid offset');
        tables.set(tag, bytes.subarray(offset, offset + length));
        if (length) spans.push({ offset, end: offset + length });
    }
    spans.sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < spans.length; i++)
        if (spans[i].offset < spans[i - 1].end) throw fail('Overlapping font tables are not supported');
    if (colorTables.some((tag) => tables.has(tag)))
        throw fail('Color, SVG, and embedded-bitmap fonts are not supported');
    if (variationTables.some((tag) => tables.has(tag)))
        throw fail('Variable fonts and CFF2 outlines are not supported; export a static font first');
    for (const [tag, minimum] of [
        ['head', 54],
        ['hhea', 36],
        ['hmtx', 4],
        ['maxp', 6],
        ['cmap', 4],
        ['name', 6]
    ] as const) {
        if (!tables.has(tag) || tables.get(tag).length < minimum)
            throw fail(`Font has a missing or truncated ${tag} table`);
    }
    const head = tables.get('head'),
        maxp = tables.get('maxp');
    const unitsPerEm = head.readUInt16BE(18),
        glyphCount = maxp.readUInt16BE(4);
    if (head.readUInt32BE(12) !== 0x5f0f3cf5 || unitsPerEm < 16 || unitsPerEm > 16384)
        throw fail('Font head metrics are invalid');
    if (!glyphCount || glyphCount > fontLimits.sourceGlyphs) throw fail('Font exceeds the 8192 source-glyph limit');
    const metricsCount = tables.get('hhea').readUInt16BE(34);
    if (
        !metricsCount ||
        metricsCount > glyphCount ||
        tables.get('hmtx').length < metricsCount * 4 + (glyphCount - metricsCount) * 2
    )
        throw fail('Font horizontal metrics are truncated');
    inspectCmap(tables.get('cmap'));
    if (format === 'ttf') {
        if (!tables.has('glyf') || !tables.has('loca') || tables.has('CFF '))
            throw fail('TrueType sources must contain glyf and loca outlines');
        inspectTrueTypeGlyphs(tables.get('glyf'), tables.get('loca'), head.readInt16BE(50), glyphCount);
    } else {
        if (!tables.has('CFF ') || tables.get('CFF ').length < 4 || tables.has('glyf'))
            throw fail('OpenType sources must contain static CFF outlines');
        inspectCff(tables.get('CFF '), glyphCount);
    }
    return Object.freeze({ format, glyphCount, unitsPerEm, hinting: false });
}

function inspectCff(cff: FontBytes, glyphCount: number) {
    if (cff[0] !== 1 || cff[2] < 4 || cff[2] >= cff.length || cff[3] < 1 || cff[3] > 4)
        throw fail('Font CFF header is invalid');
    const index = (at: number) => {
        if (at < 0 || at + 2 > cff.length) throw fail('Font CFF index is truncated');
        const count = cff.readUInt16BE(at);
        if (!count) return { end: at + 2, objects: [] };
        if (count > fontLimits.sourceGlyphs) throw fail('Font CFF index exceeds 8192 entries');
        const size = cff[at + 2],
            start = at + 3 + (count + 1) * size;
        if (size < 1 || size > 4 || start > cff.length) throw fail('Font CFF index offsets are invalid');
        const offsets = Array.from({ length: count + 1 }, (_, i) => cff.readUIntBE(at + 3 + i * size, size));
        if (offsets[0] !== 1 || offsets[count] < 1 || start + offsets[count] - 1 > cff.length)
            throw fail('Font CFF index extends outside its table');
        const objects: FontBytes[] = [];
        for (let i = 0; i < count; i++) {
            if (offsets[i + 1] < offsets[i]) throw fail('Font CFF index offsets are not monotonic');
            objects.push(cff.subarray(start + offsets[i] - 1, start + offsets[i + 1] - 1));
        }
        return { end: start + offsets[count] - 1, objects };
    };
    const names = index(cff[2]),
        top = index(names.end);
    if (names.objects.length !== 1 || top.objects.length !== 1) throw fail('CFF font collections are not supported');
    const strings = index(top.end);
    index(strings.end); // Global subroutines: validate their offset directory too.
    const dict = top.objects[0],
        operands: number[] = [];
    let charStrings: number | undefined;
    const need = (at: number, size: number) => {
        if (at + size > dict.length) throw fail('Font CFF dictionary is truncated');
    };
    for (let at = 0; at < dict.length;) {
        const token = dict[at++];
        if (token >= 32 && token <= 246) operands.push(token - 139);
        else if (token >= 247 && token <= 254) {
            need(at, 1);
            operands.push(
                token <= 250 ? (token - 247) * 256 + dict[at++] + 108 : -(token - 251) * 256 - dict[at++] - 108
            );
        } else if (token === 28 || token === 29) {
            const size = token === 28 ? 2 : 4;
            need(at, size);
            operands.push(size === 2 ? dict.readInt16BE(at) : dict.readInt32BE(at));
            at += size;
        } else if (token === 30) {
            let ended = false;
            while (at < dict.length) {
                const value = dict[at++];
                if (value >>> 4 === 15 || (value & 15) === 15) {
                    ended = true;
                    break;
                }
            }
            if (!ended) throw fail('Font CFF real number is truncated');
            operands.push(NaN); // Real-valued metrics are not offsets.
        } else if (token <= 21) {
            if (token === 12) {
                need(at, 1);
                at++;
            }
            if (token === 17) {
                if (operands.length !== 1 || !Number.isSafeInteger(operands[0]) || operands[0] < 0)
                    throw fail('Font CFF CharStrings offset is invalid');
                charStrings = operands[0];
            }
            operands.length = 0;
        } else throw fail('Font CFF dictionary has an unsupported token');
        if (operands.length > 48) throw fail('Font CFF dictionary operand count exceeds 48');
    }
    if (charStrings === undefined || index(charStrings).objects.length !== glyphCount)
        throw fail('Font CFF glyph count does not match its maxp table');
}

function inspectCmap(cmap: FontBytes) {
    const count = cmap.readUInt16BE(2);
    if (!count || count > 64 || 4 + count * 8 > cmap.length) throw fail('Font cmap directory is invalid');
    for (let i = 0; i < count; i++) {
        const offset = cmap.readUInt32BE(8 + i * 8);
        if (offset < 4 + count * 8 || offset + 4 > cmap.length) throw fail('Font cmap offset is invalid');
        const format = cmap.readUInt16BE(offset);
        let length;
        if ([8, 10, 12, 13].includes(format)) {
            if (offset + 8 > cmap.length) throw fail('Font cmap subtable is truncated');
            length = cmap.readUInt32BE(offset + 4);
        } else if (format === 14) {
            if (offset + 6 > cmap.length) throw fail('Font cmap subtable is truncated');
            length = cmap.readUInt32BE(offset + 2);
        } else {
            length = cmap.readUInt16BE(offset + 2);
        }
        if (length < 4 || offset + length > cmap.length) throw fail('Font cmap subtable extends outside its table');
    }
}

function inspectTrueTypeGlyphs(glyf: FontBytes, loca: FontBytes, locationFormat: number, glyphCount: number) {
    if (![0, 1].includes(locationFormat)) throw fail('Font loca format is invalid');
    const stride = locationFormat === 0 ? 2 : 4;
    if (loca.length < (glyphCount + 1) * stride) throw fail('Font loca table is truncated');
    const offsets = Array.from({ length: glyphCount + 1 }, (_, i) =>
        stride === 2 ? loca.readUInt16BE(i * 2) * 2 : loca.readUInt32BE(i * 4)
    );
    const edges = Array.from({ length: glyphCount }, () => [] as number[]);
    for (let i = 0; i < glyphCount; i++) {
        const start = offsets[i],
            end = offsets[i + 1];
        if (end < start || end > glyf.length) throw fail('Font glyph offsets are invalid');
        if (start === end) continue;
        if (end - start < 10) throw fail('Font glyph header is truncated');
        const contours = glyf.readInt16BE(start);
        if (contours >= 0) {
            if (contours > fontLimits.glyphContours || start + 12 + contours * 2 > end)
                throw fail('Font glyph contour count is invalid or excessive');
            let previous = -1;
            for (let c = 0; c < contours; c++) {
                const point = glyf.readUInt16BE(start + 10 + c * 2);
                if (point <= previous || point >= fontLimits.glyphPoints)
                    throw fail('Font glyph exceeds the bounded point count');
                previous = point;
            }
            const instructionAt = start + 10 + contours * 2;
            if (instructionAt + 2 + glyf.readUInt16BE(instructionAt) > end)
                throw fail('Font glyph hint instructions are truncated');
        } else if (contours === -1) {
            let at = start + 10,
                flags;
            do {
                if (at + 4 > end || edges[i].length >= fontLimits.compositeComponents)
                    throw fail('Font composite glyph is truncated or exceeds 64 components');
                flags = glyf.readUInt16BE(at);
                const component = glyf.readUInt16BE(at + 2);
                if (component >= glyphCount) throw fail('Font composite glyph references an invalid glyph');
                edges[i].push(component);
                at += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 64 ? 4 : flags & 128 ? 8 : 0);
                if (at > end) throw fail('Font composite glyph arguments are truncated');
            } while (flags & 32);
            if (flags & 256 && (at + 2 > end || at + 2 + glyf.readUInt16BE(at) > end))
                throw fail('Font composite hint instructions are truncated');
        } else {
            throw fail('Font has an unsupported glyph contour format');
        }
    }
    const visiting = new Set<number>(),
        depths = new Map<number, number>();
    const visit = (index: number): number => {
        if (visiting.has(index)) throw fail('Cyclic composite glyphs are not supported');
        if (depths.has(index)) return depths.get(index);
        visiting.add(index);
        if (visiting.size > fontLimits.compositeDepth) throw fail('Font composite glyph nesting exceeds 16 levels');
        let depth = 1;
        for (const child of edges[index]) depth = Math.max(depth, visit(child) + 1);
        visiting.delete(index);
        if (depth > fontLimits.compositeDepth) throw fail('Font composite glyph nesting exceeds 16 levels');
        depths.set(index, depth);
        return depth;
    };
    for (let i = 0; i < glyphCount; i++) visit(i);
}

/**
 * `chars` is literal text, as in the Editor, never a magic preset name.
 * Controls used for text layout are omitted; malformed Unicode is rejected.
 */
export function normalizeFontOptions(options: Record<string, any> = {}, filename = 'font.ttf') {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw fail('Font options must be an object');
    const supported = new Set(['chars', 'fontName', 'intensity', 'invert', 'size', 'pxrange', 'kerning']);
    for (const key of Object.keys(options))
        if (!supported.has(key))
            throw fail(
                `Unsupported font option: ${key}; hinting, variations, shaping and bitmap/color modes are not supported`
            );
    const chars = options.chars ?? defaultFontChars;
    if (typeof chars !== 'string' || new TextEncoder().encode(chars).length > fontLimits.characterBytes)
        throw fail('Font characters must be literal text of at most 4096 UTF-8 bytes');
    const points = new Set<number>();
    for (const char of chars) {
        const point = char.codePointAt(0)!;
        if ([9, 10, 13].includes(point)) continue;
        if (point < 32 || (point >= 0x7f && point <= 0x9f) || (point >= 0xd800 && point <= 0xdfff))
            throw fail('Font characters must contain valid printable Unicode scalar values');
        points.add(point);
        if (points.size > fontLimits.characters) throw fail('Font conversion is limited to 512 unique characters');
    }
    if (!points.size) throw fail('At least one printable font character is required');
    const codepoints = [...points].sort((a, b) => a - b);
    const size = options.size ?? 64,
        pxrange = options.pxrange ?? 8,
        intensity = options.intensity ?? 0;
    if (![32, 64, 128].includes(size)) throw fail('Font glyph size must be 32, 64, or 128 pixels');
    if (!Number.isFinite(pxrange) || pxrange < 1 || pxrange > Math.min(32, size / 2))
        throw fail('Font pxrange must be between 1 and half the glyph size, at most 32');
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1)
        throw fail('Font intensity must be between 0 and 1');
    for (const key of ['invert', 'kerning'])
        if (options[key] !== undefined && typeof options[key] !== 'boolean')
            throw fail(`Font ${key} must be a boolean`);
    if (codepoints.length > Math.floor(fontLimits.atlasDimension / (size + 2)) ** 2)
        throw fail('Requested characters exceed the single 2048-pixel atlas capacity at this glyph size');
    if (options.kerning && codepoints.length > 128) throw fail('Kerning extraction is limited to 128 characters');
    const fontName = options.fontName ?? filename.replace(/\.[^.]+$/, '').slice(0, 128);
    if (typeof fontName !== 'string' || !fontName.trim() || fontName.length > 128 || hasControl(fontName))
        throw fail('Font name must be 1–128 printable characters');
    return Object.freeze({
        chars: String.fromCodePoint(...codepoints),
        codepoints,
        fontName,
        intensity,
        invert: options.invert ?? false,
        size,
        pxrange,
        kerning: options.kerning ?? false
    });
}
