import { Events } from '@playcanvas/observer';

import { globals as api } from './globals';
import type {
    TinyAppBuildListResponse,
    TinyAppBuildRecord,
    TinyAppChildStrategy,
    TinyAppDeleteResult,
    TinyAppInspectResult,
    TinyAppProjectSummaryResponse,
    TinyAppServiceStatus
} from './rest/tinyapps';

export type TinyAppBuildOptions = {
    branchId?: string;
    sceneId?: string | number | null;
    label?: string;
    suffix?: string;
    prefix?: string;
    childStrategy?: TinyAppChildStrategy;
};

export type TinyAppWaitOptions = {
    intervalMs?: number;
    timeoutMs?: number;
    onProgress?: (build: TinyAppBuildRecord) => void;
};

function parseFilenameFromDisposition(disposition: string | null, fallback: string): string {
    if (!disposition) return fallback;
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    if (!match?.[1]) return fallback;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

/**
 * High-level API for inspecting, packaging, downloading, and managing TinyApp
 * builds produced from PlayCanvas Template assets on self-hosted Editor servers.
 */
class TinyApps extends Events {
    /**
     * Whether the current Editor host advertises backend TinyApp packaging support.
     *
     * @returns True when connected to a self-hosted server supporting TinyApps.
     */
    isSupported(): boolean {
        const cfg = (globalThis as { config?: { selfhost?: { tinyAppPipeline?: string } } }).config;
        return cfg?.selfhost?.tinyAppPipeline === 'server-v1';
    }

    /**
     * Queries backend TinyApp service availability and CDN configuration summary.
     *
     * @returns The service status descriptor.
     */
    status(): Promise<TinyAppServiceStatus> {
        return api.rest.tinyapps.tinyappStatus().promisify();
    }

    /**
     * Inspects a Template asset's TinyApp dependency closure, ES5 scripts, nested
     * child Templates, content hash, unbuilt-change status, and runtime warnings.
     *
     * @param templateAssetId - The Template asset ID.
     * @param options - Optional branch override.
     * @returns Detailed inspection result.
     */
    inspect(
        templateAssetId: number,
        options: { branchId?: string } = {}
    ): Promise<TinyAppInspectResult> {
        return api.rest.tinyapps
            .tinyappInspect({
                assetId: Number(templateAssetId),
                branchId: options.branchId
            })
            .promisify();
    }

    /**
     * Lists all TinyApp builds and per-Template summaries in the current project.
     *
     * @param options - Search, status filter, and pagination options.
     * @returns Project-wide TinyApp summary and build records.
     */
    listProject(
        options: { q?: string; status?: string; skip?: number; limit?: number } = {}
    ): Promise<TinyAppProjectSummaryResponse> {
        return api.rest.tinyapps.tinyappProjectList(options).promisify();
    }

    /**
     * Lists historical TinyApp builds for a specific Template asset.
     *
     * @param templateAssetId - The Template asset ID.
     * @param options - Optional branch/status filter and pagination.
     * @returns Paginated TinyApp build records for the Template.
     */
    list(
        templateAssetId: number,
        options: { branchId?: string; status?: string; skip?: number; limit?: number } = {}
    ): Promise<TinyAppBuildListResponse> {
        return api.rest.tinyapps
            .tinyappBuildList({
                assetId: Number(templateAssetId),
                ...options
            })
            .promisify();
    }

    /**
     * Gets full details (including uploaded object manifest and parent/child links)
     * for a specific TinyApp build.
     *
     * @param buildId - The TinyApp build ID.
     * @returns Detailed build record.
     */
    get(buildId: number): Promise<TinyAppBuildRecord> {
        return api.rest.tinyapps.tinyappBuildGet({ buildId: Number(buildId) }).promisify();
    }

    /**
     * Starts an asynchronous backend TinyApp build and CDN upload job.
     *
     * @param templateAssetId - The Template asset ID to build.
     * @param options - Optional label, suffix, prefix, and child reuse strategy.
     * @returns The newly queued TinyApp build record.
     */
    async build(
        templateAssetId: number,
        options: TinyAppBuildOptions = {}
    ): Promise<TinyAppBuildRecord> {
        const cfg = (globalThis as { config?: { scene?: { id?: string } } }).config;
        const record = await api.rest.tinyapps
            .tinyappBuildStart({
                assetId: Number(templateAssetId),
                sceneId: options.sceneId ?? cfg?.scene?.id ?? null,
                ...options
            })
            .promisify();
        this.emit('build:start', record);
        return record;
    }

    /**
     * Polls a TinyApp build until it reaches a terminal state (`complete` or `error`).
     *
     * @param buildId - The TinyApp build ID.
     * @param options - Polling interval, timeout, and progress callback.
     * @returns The completed TinyApp build record.
     */
    async wait(buildId: number, options: TinyAppWaitOptions = {}): Promise<TinyAppBuildRecord> {
        const intervalMs = Math.max(250, options.intervalMs ?? 1000);
        const timeoutMs = Math.max(5000, options.timeoutMs ?? 180000);
        const deadline = Date.now() + timeoutMs;

        while (true) {
            const current = await this.get(buildId);
            if (options.onProgress) {
                options.onProgress(current);
            }
            if (current.status === 'complete') {
                this.emit('build:complete', current);
                return current;
            }
            if (current.status === 'error') {
                this.emit('build:error', current);
                throw new Error(current.error || current.message || 'TinyApp build failed');
            }
            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for TinyApp build ${buildId}`);
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
    }

    /**
     * Starts a TinyApp build and waits for completion.
     *
     * @param templateAssetId - The Template asset ID to build.
     * @param options - Build and wait options.
     * @returns The completed TinyApp build record with `publicUrl`.
     */
    async buildAndWait(
        templateAssetId: number,
        options: TinyAppBuildOptions & TinyAppWaitOptions = {}
    ): Promise<TinyAppBuildRecord> {
        const started = await this.build(templateAssetId, options);
        return this.wait(started.id, options);
    }

    /**
     * Deletes a historical TinyApp build record and removes its files from OSS/COS.
     *
     * @param buildId - The TinyApp build ID.
     * @param options - Pass `force: true` to delete even when referenced by parent builds.
     * @returns Deletion summary including deleted object count and freed bytes.
     */
    async delete(buildId: number, options: { force?: boolean } = {}): Promise<TinyAppDeleteResult> {
        const res = await api.rest.tinyapps
            .tinyappBuildDelete({
                buildId: Number(buildId),
                force: options.force
            })
            .promisify();
        this.emit('build:delete', res);
        return res;
    }

    /**
     * Generates a local troubleshooting `.zip` archive for a Template asset without
     * publishing to cloud storage.
     *
     * @param templateAssetId - The Template asset ID.
     * @param options - Optional branch, suffix, childStrategy, and auto-download flag.
     * @returns Archive filename and binary Blob.
     */
    async downloadTemplateArchive(
        templateAssetId: number,
        options: TinyAppBuildOptions & { triggerBrowserDownload?: boolean } = {}
    ): Promise<{ filename: string; blob: Blob }> {
        const cfg = (globalThis as { config?: { scene?: { id?: string } } }).config;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (api.accessToken) {
            headers.Authorization = `Bearer ${api.accessToken}`;
        }
        const response = await fetch(
            `${api.apiUrl}/projects/${api.projectId}/templates/${Number(templateAssetId)}/tinyapp/archive`,
            {
                method: 'POST',
                credentials: 'same-origin',
                headers,
                body: JSON.stringify({
                    branchId: options.branchId ?? api.branchId,
                    sceneId: options.sceneId ?? cfg?.scene?.id ?? null,
                    suffix: options.suffix,
                    childStrategy: options.childStrategy
                })
            }
        );
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error || payload?.message || `Archive export failed (${response.status})`);
        }
        const blob = await response.blob();
        const filename = parseFilenameFromDisposition(
            response.headers.get('content-disposition'),
            `template-${templateAssetId}-tinyapp.zip`
        );
        if (options.triggerBrowserDownload !== false && typeof document !== 'undefined') {
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        }
        return { filename, blob };
    }

    /**
     * Downloads the `.zip` archive of an already-published historical TinyApp build.
     *
     * @param buildId - The TinyApp build ID.
     * @param options - Optional auto-download flag.
     * @returns Archive filename and binary Blob.
     */
    async downloadBuildArchive(
        buildId: number,
        options: { triggerBrowserDownload?: boolean } = {}
    ): Promise<{ filename: string; blob: Blob }> {
        const headers: Record<string, string> = {};
        if (api.accessToken) {
            headers.Authorization = `Bearer ${api.accessToken}`;
        }
        const response = await fetch(
            `${api.apiUrl}/projects/${api.projectId}/tinyapps/builds/${Number(buildId)}/download`,
            {
                method: 'GET',
                credentials: 'same-origin',
                headers
            }
        );
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.error || payload?.message || `Build download failed (${response.status})`);
        }
        const blob = await response.blob();
        const filename = parseFilenameFromDisposition(
            response.headers.get('content-disposition'),
            `tinyapp-build-${buildId}.zip`
        );
        if (options.triggerBrowserDownload !== false && typeof document !== 'undefined') {
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        }
        return { filename, blob };
    }
}

export { TinyApps };
export type * from './rest/tinyapps';
