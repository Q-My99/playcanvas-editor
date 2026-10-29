// Only the browser talks to the server. The extension transports bounded chunks
// and fixed compute messages; no server session, lease or URL is sent to daemon.
import { globals as api } from '../globals';

const CHANNEL = 'playcanvas-agent-bridge';
const requestId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
let sessionId: string;
const active = new Set<string>();
type Request = (path: string, method?: string, body?: object, signal?: AbortSignal) => Promise<any>;

function daemon(action: string, body: object = {}, timeout = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
        const id = requestId();
        const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('LOCAL_BRIDGE_TIMEOUT')); }, timeout);
        const listener = (event: MessageEvent) => {
            if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.side !== 'isolated' || event.data?.type !== 'daemon-response' || event.data?.id !== id) return;
            clearTimeout(timer); window.removeEventListener('message', listener);
            if (event.data.ok) resolve(event.data.data);
            else reject(new Error(event.data.error?.message || 'LOCAL_BRIDGE_ERROR'));
        };
        window.addEventListener('message', listener);
        window.postMessage({ channel: CHANNEL, side: 'main', type: 'daemon-request', id, path: `/processing/${action}`, method: 'POST', body }, window.location.origin);
    });
}
export async function localIntent() {
    if (!window.config || !('selfhost' in window.config) || !window.config.selfhost) return undefined;
    try {
        sessionId ||= requestId();
        const capabilities = await daemon('capabilities', {}, 750);
        return { preferLocal: capabilities.available === true, capabilities, browserSessionId: sessionId, fallbackReason: capabilities.reason };
    } catch { return { preferLocal: false, fallbackReason: 'LOCAL_BRIDGE_UNAVAILABLE' }; }
}
function encode(bytes: Uint8Array) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
}
function decode(data: string): Uint8Array<ArrayBuffer> {
    const binary = atob(data);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function startLocalJob(result: any, request: Request) {
    const job = result?.importJob || (result?.executor ? result : null);
    if (!job || job.executor !== 'local' || job.status !== 'queued' || active.has(job.id)) return;
    active.add(job.id);
    void execute(job, request).finally(() => active.delete(job.id));
}
async function execute(job: any, request: Request) {
    let transferId: string | undefined;
    let lease: { lease: string; attempt: number } | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let renewing = false;
    let phase = 'local-convert';
    const controller = new AbortController();
    const branchId = api.branchId;
    const check = () => {
        if (controller.signal.aborted || api.branchId !== branchId) throw new Error('LOCAL_EXECUTION_INTERRUPTED');
    };
    try {
        const intent = await localIntent();
        const claimed = await request(`/jobs/${job.id}/claim-local`, 'POST', { capabilities: intent?.capabilities, browserSessionId: sessionId });
        if (!claimed.claimed) return;
        lease = { lease: claimed.lease, attempt: claimed.attempt };
        timer = setInterval(() => {
            if (renewing) return;
            renewing = true;
            void (async () => {
                check();
                await request(`/jobs/${job.id}/heartbeat`, 'POST', { ...lease, phase }, controller.signal);
                if (transferId) await daemon('status', { transferId });
            })().catch(() => controller.abort()).finally(() => { renewing = false; });
        }, 5000);
        const begun = await daemon('begin', { jobId: job.id, kind: job.kind,
            source: { filename: claimed.source.filename, size: claimed.source.size, hash: claimed.source.hash }, options: claimed.options });
        transferId = begun.transferId;
        const response = await fetch(claimed.source.url, { credentials: 'include', signal: controller.signal,
            headers: api.accessToken ? { Authorization: `Bearer ${api.accessToken}` } : {} });
        if (!response.ok || !response.body) throw new Error('SOURCE_DOWNLOAD_FAILED');
        const reader = response.body.getReader();
        let offset = 0;
        try {
            for (;;) {
                check();
                const { value, done } = await reader.read();
                if (done) break;
                for (let i = 0; i < value.length; i += begun.chunkBytes) {
                    const bytes = value.subarray(i, i + begun.chunkBytes);
                    await daemon('chunk', { transferId, offset, data: encode(bytes) });
                    offset += bytes.length;
                }
            }
        } finally { await reader.cancel().catch(() => {}); }
        await daemon('run', { transferId });
        let computed;
        for (;;) {
            check();
            computed = await daemon('status', { transferId });
            if (computed.state === 'computed') break;
            if (computed.state === 'failed') throw new Error(computed.error);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        phase = 'upload';
        const uploadIds = new Map<string, string>();
        for (const [fileId, file] of Object.entries<any>(computed.files)) {
            check();
            const session = await request(`/jobs/${job.id}/artifacts/uploads`, 'POST', { ...lease, ...file }, controller.signal);
            const parts = [];
            let offset = 0;
            for (let part = 0; part < session.parts; part++) {
                const chunks: BlobPart[] = [];
                const end = Math.min(file.size, (part + 1) * session.partSize);
                while (offset < end) {
                    check();
                    const chunk = await daemon('read', { transferId, fileId, offset });
                    const bytes = decode(chunk.data);
                    if (!bytes.length || offset + bytes.length > end) throw new Error('INVALID_OUTPUT_CHUNK');
                    chunks.push(bytes); offset += bytes.length;
                }
                const blob = new Blob(chunks);
                for (let retry = 0; ; retry++) {
                    try {
                        const uploaded = await fetch(session.urls[part], { method: 'PUT', body: blob, signal: controller.signal });
                        const etag = uploaded.headers.get('ETag');
                        if (!uploaded.ok || !etag) throw new Error('ARTIFACT_UPLOAD_FAILED');
                        parts.push({ PartNumber: part + 1, ETag: etag });
                        break;
                    } catch (error) {
                        check();
                        if (retry >= 2) throw error;
                        session.urls = (await request(`/jobs/${job.id}/artifacts/uploads/${session.uploadId}/urls`, 'POST', lease, controller.signal)).urls;
                    }
                }
            }
            await request(`/jobs/${job.id}/artifacts/uploads/${session.uploadId}/complete`, 'POST', { ...lease, parts }, controller.signal);
            uploadIds.set(fileId, session.uploadId);
        }
        const manifest = computed.manifest;
        for (const artifact of manifest.artifacts) {
            if (artifact.fileId) { artifact.uploadId = uploadIds.get(artifact.fileId); delete artifact.fileId; }
            for (const thumb of Object.values<any>(artifact.thumbnails || {})) {
                thumb.uploadId = uploadIds.get(thumb.fileId); delete thumb.fileId;
            }
        }
        check();
        await request(`/jobs/${job.id}/submit-manifest`, 'POST', { ...lease, ...manifest }, controller.signal);
    } catch (error) {
        if (lease) await request(`/jobs/${job.id}/release-local`, 'POST', { ...lease, reason: 'LOCAL_EXECUTION_FAILED', error: String(error) }).catch(() => {});
    } finally {
        if (timer) clearInterval(timer);
        controller.abort();
        if (transferId) await daemon('finish', { transferId }).catch(() => {});
    }
}
