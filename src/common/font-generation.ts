import { WorkerClient } from '../core/worker/worker-client';

import { fontLimits } from './font-contract';

export type FontGenerateResult = {
    data: any;
    json: Uint8Array;
    textures: Uint8Array[];
    manifest: {
        version: string;
        source: { size: number; hash: string };
        json: { size: number; hash: string };
        atlas: { size: number; hash: string };
        missing: string[];
        automaticInvert: boolean;
    };
};

let activeWorkers = 0;

/** Bound both WASM execution and startup; terminate workers on every exit path. */
export const generateFont = (
    frontendURL: string,
    buffer: ArrayBuffer,
    options: Record<string, unknown>,
    filename = 'font.ttf'
): Promise<FontGenerateResult> => {
    if (buffer.byteLength > fontLimits.sourceBytes) {
        return Promise.reject(new Error('Font sources are limited to 4 MiB'));
    }
    if (activeWorkers >= fontLimits.activeWorkers) {
        return Promise.reject(new Error('Font converter is busy; retry after the current conversion finishes'));
    }
    activeWorkers++;
    return new Promise((resolve, reject) => {
        const client = new WorkerClient(`${frontendURL}js/font-generate.worker.js`);
        let settled = false;
        const settle = (error?: string, result?: FontGenerateResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            client.stop();
            activeWorkers--;
            if (error) reject(new Error(error));
            else resolve(result!);
        };
        const timer = setTimeout(
            () => settle('Font generation exceeded the 20 second deadline'),
            fontLimits.workerMilliseconds
        );
        client.once('error', (error) => settle(error || 'The font generator could not be loaded'));
        client.once('ready', () => {
            if (settled) return;
            client.once('generate', (result) => settle(undefined, result));
            try {
                client.with([buffer]).send('generate', frontendURL, buffer, options, filename);
            } catch (error) {
                settle(String(error));
            }
        });
        client
            .start()
            .then(() => {
                // A cross-origin worker fetch can finish after the deadline.
                if (settled) client.stop();
            })
            .catch((error) => settle(`The font generator could not be loaded (${error?.message ?? error})`));
    });
};
