import { config } from '@/editor/config';
import { importRequest } from '@/editor-api/assets/import-model';

editor.once('load', () => {
    if (config.selfhost?.modelPipeline !== 'worker-v1') return;
    const notified = new Set<string>();
    let pending = false;
    let jobs = [];
    let olderJobs = [];
    let nextOffset: number | null = null;
    const dialog = document.createElement('dialog');
    dialog.className = 'asset-import-jobs';
    dialog.setAttribute('aria-label', 'Asset import jobs');
    const title = document.createElement('h2'); title.textContent = 'Asset import jobs';
    const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => dialog.close();
    const list = document.createElement('div');
    const more = document.createElement('button'); more.textContent = 'Load more';
    more.onclick = async () => {
        if (nextOffset === null) return;
        more.disabled = true;
        try {
            const api = editor.api.globals;
            const response = await importRequest(`/jobs?projectId=${api.projectId}&branchId=${encodeURIComponent(api.branchId)}&offset=${nextOffset}`);
            olderJobs.push(...response.jobs); nextOffset = response.nextOffset; render();
        } catch (error) { editor.call('status:error', error.message); }
        finally { more.disabled = false; }
    };
    dialog.append(title, close, list, more); document.body.append(dialog);
    const render = () => {
        if (!dialog.open) return;
        list.replaceChildren();
        more.hidden = nextOffset === null;
        for (const job of new Map([...olderJobs, ...jobs].map(job => [job.id, job])).values()) {
            const row = document.createElement('article');
            const label = document.createElement('strong'); label.textContent = job.filename || `Asset ${job.assetId}`;
            const status = document.createElement('p');
            status.textContent = job.status === 'failed' ? job.error : `${job.executor || 'server'} · ${job.phase}${job.status === 'queued' ? '' : ` · ${Math.round((job.progress || 0) * 100)}%`}`;
            row.append(label, status);
            for (const warning of job.warnings || []) { const message = document.createElement('p'); message.textContent = warning; row.append(message); }
            const action = ['failed', 'cancelled'].includes(job.status) ? 'retry' : job.status === 'complete' || job.status === 'publishing' ? null : 'cancel';
            if (action && editor.call('permissions:write')) {
                const button = document.createElement('button'); button.textContent = action === 'retry' ? 'Retry' : 'Cancel';
                button.onclick = async () => {
                    button.disabled = true;
                    try { await importRequest(`/jobs/${encodeURIComponent(job.id)}/${action}`, 'POST', {}); olderJobs = []; await refresh(); }
                    catch (error) { editor.call('status:error', error.message); button.disabled = false; }
                };
                row.append(button);
            }
            list.append(row);
        }
        if (!jobs.length) list.textContent = 'No recent asset import jobs.';
    };
    editor.method('assets:import:showJobs', () => { if (!dialog.open) dialog.showModal(); render(); });
    const refresh = async () => {
        if (pending) return;
        pending = true;
        try {
            const api = editor.api.globals;
            const response = await importRequest(`/jobs?projectId=${api.projectId}&branchId=${encodeURIComponent(api.branchId)}`);
            jobs = response.jobs;
            if (!olderJobs.length) nextOffset = response.nextOffset;
            render();
            const summary = response.summary;
            editor.call('status:job', 'asset-import:summary', summary.active ? summary.progress : undefined, 'running', summary.active, summary.queued);
            for (const job of response.jobs) {
                if (['complete', 'failed', 'cancelled'].includes(job.status)) {
                    if (job.status === 'failed' && !notified.has(job.id)) {
                        editor.call('status:error', `Asset import failed: ${job.error || 'Unknown conversion error'}`);
                        notified.add(job.id);
                    }
                    continue;
                }
            }
        } catch {
            // Reconnect polling retains existing indicators until authoritative state arrives.
        } finally {
            pending = false;
        }
    };
    editor.method('assets:import:jobs', () => importRequest(`/jobs?projectId=${editor.api.globals.projectId}&branchId=${encodeURIComponent(editor.api.globals.branchId)}`));
    editor.method('assets:import:request', (path: string, method = 'GET', data?: object) => importRequest(path, method, data));
    editor.method('assets:import:cancel', (id: string) => importRequest(`/jobs/${encodeURIComponent(id)}/cancel`, 'POST', {}));
    editor.on('messenger:asset.import.progress', refresh);
    editor.on('realtime:authenticated', refresh);
    let timer = setInterval(refresh, 1500);
    window.addEventListener('pagehide', () => clearInterval(timer));
    window.addEventListener('pageshow', () => { clearInterval(timer); timer = setInterval(refresh, 1500); void refresh(); });
    void refresh();
});
