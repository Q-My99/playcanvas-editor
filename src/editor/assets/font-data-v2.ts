type FontGlyphV3 = {
    id: number;
    [key: string]: unknown;
};

type FontDataV3 = {
    intensity?: number;
    info?: {
        face?: string;
        maps?: { width: number; height: number }[];
    };
    chars: Record<string, FontGlyphV3>;
    kerning?: Record<string, unknown>;
};

export const toFontDataV2 = (data: FontDataV3) => {
    const chars: Record<string, FontGlyphV3> = {};
    for (const letter in data.chars) {
        const glyph = data.chars[letter];
        chars[glyph.id] = glyph;
    }

    const maps = data.info?.maps ?? [];
    const firstMap = maps[0] ?? { width: 0, height: 0 };
    return {
        version: 2,
        intensity: data.intensity ?? 0,
        info: {
            face: data.info?.face,
            width: firstMap.width,
            height: firstMap.height,
            maps
        },
        chars,
        kerning: data.kerning ?? {}
    };
};

export const requireSingleFontAtlas = (textures: Uint8Array[]) => {
    if (textures.length !== 1) {
        throw new Error(
            `Font generation produced ${textures.length} atlas pages. Reduce the character set so it fits in one page.`
        );
    }
};

export type { FontDataV3 };
