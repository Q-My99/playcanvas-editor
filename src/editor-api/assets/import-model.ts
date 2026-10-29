import { Events } from '@playcanvas/observer';

import { localIntent, startLocalJob } from './local-processing';

import { globals as api } from '../globals';

export async function importRequest(path: string, method = 'GET', data?: object, signal?: AbortSignal) {
    if (method === 'POST' && (path === '/uploads' || /^\/[^/]+\/(?:reimport|texture)$/.test(path) || /^\/jobs\/[^/]+\/retry$/.test(path))) {
        data = { ...data, localIntent: await localIntent() };
    }
    const response = await fetch(`${api.apiUrl}/asset-imports${path}`, {
        method,
        credentials: 'include',
        signal,
        headers: { ...(api.accessToken ? { Authorization: `Bearer ${api.accessToken}` } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Import request failed (${response.status})`);
    startLocalJob(result, importRequest);
    return result;
}

export class ModelUpload extends Events {
    private controller = new AbortController();

    constructor(data: any, options: any, assetId?: string | number) {
        super();
        queueMicrotask(() => this.upload(data, options, assetId).catch(error => this.emit('error', 400, error.message)));
    }

    abort() {
        this.controller.abort();
    }

    private async upload(data: any, options: any, assetId?: string | number) {
        const file: File = data.file;
        const signal = this.controller.signal;
        const session = await importRequest('/uploads', 'POST', {
            projectId: api.projectId,
            branchId: api.branchId,
            parent: data.parent?.get ? data.parent.get('id') : data.parent || data.folderId,
            assetId,
            expectedHash: data.asset?.get('file.hash'),
            filename: data.filename || file.name,
            size: file.size,
            options
        }, signal);
        const completed = new Map<number, string>();
        const transferred = new Map<number, number>();
        try {
            let urls = (await importRequest(`/uploads/${session.id}/urls`, 'POST', {}, signal)).urls;
            let next = 0;
            const transfer = async () => {
                while (next < session.parts) {
                    const index = next++;
                    const blob = file.slice(index * session.partSize, Math.min(file.size, (index + 1) * session.partSize));
                    for (let attempt = 0; ; attempt++) {
                        try {
                            const etag = await new Promise<string>((resolve, reject) => {
                                const xhr = new XMLHttpRequest();
                                const abort = () => xhr.abort();
                                signal.addEventListener('abort', abort, { once: true });
                                xhr.open('PUT', urls[index]);
                                xhr.upload.onprogress = event => {
                                    transferred.set(index, event.loaded);
                                    this.emit('progress', [...transferred.values()].reduce((a, b) => a + b, 0) / file.size);
                                };
                                xhr.onloadend = () => signal.removeEventListener('abort', abort);
                                xhr.onload = () => {
                                    const etag = xhr.getResponseHeader('ETag');
                                    if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
                                    else reject(new Error('Object upload failed; S3 CORS must expose ETag'));
                                };
                                xhr.onerror = () => reject(new Error('Object upload interrupted'));
                                xhr.onabort = () => reject(new Error('Upload cancelled'));
                                if (signal.aborted) reject(new Error('Upload cancelled'));
                                else xhr.send(blob);
                            });
                            completed.set(index + 1, etag);
                            transferred.set(index, blob.size);
                            break;
                        } catch (error) {
                            if (signal.aborted || attempt >= 2) throw error;
                            urls = (await importRequest(`/uploads/${session.id}/urls`, 'POST', {}, signal)).urls;
                        }
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(4, session.parts) }, transfer));
            const result = await importRequest(`/uploads/${session.id}/complete`, 'POST', {
                parts: [...completed].sort((a, b) => a[0] - b[0]).map(([PartNumber, ETag]) => ({ PartNumber, ETag }))
            }, signal);
            this.emit('progress', 1);
            this.emit('load', 201, result);
        } catch (error) {
            this.controller.abort();
            await importRequest(`/uploads/${session.id}`, 'DELETE').catch(() => { /* Preserve the original upload error. */ });
            throw error;
        }
    }
}

export const isModelImport = (data: any) => typeof window !== 'undefined' &&
    window.config && 'selfhost' in window.config && window.config.selfhost?.modelPipeline === 'worker-v1' &&
    (data.type || data.asset?.get('type')) === 'scene' && data.file && /\.(glb|fbx|obj)$/i.test(data.filename || data.file.name);
