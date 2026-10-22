import { generateFont } from '@/common/font-generation';
import type { FontGenerateResult } from '@/common/font-generation';

editor.once('load', () => {
    editor.method(
        'fonts:generate',
        (
            buffer: ArrayBuffer,
            options: Record<string, unknown>,
            callback: (error: string | null, result?: FontGenerateResult) => void,
            filename?: string
        ) => {
            generateFont(config.url.frontend, buffer, options, filename).then(
                (result) => callback(null, result),
                (error) => callback(String(error?.message ?? error))
            );
        }
    );
});
