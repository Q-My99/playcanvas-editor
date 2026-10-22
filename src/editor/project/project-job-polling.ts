/** Poll durable self-hosted jobs instead of relying on a currently watched project. */
type ProjectJob = { id: number; status: string; messages?: string[]; data?: Record<string, any> };
type Options = { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number };

export const pollProjectJob = async (jobId: number, getJob: (id: number) => Promise<ProjectJob>, options: Options = {}): Promise<ProjectJob> => {
    if (!Number.isSafeInteger(jobId) || jobId < 1) throw new Error('Invalid project job ID');
    const { signal, intervalMs = 500, timeoutMs = 30 * 60 * 1000 } = options;
    const started = Date.now();
    const aborted = () => Object.assign(new Error('Stopped waiting for project job; the server job may still be running'), { name: 'AbortError' });
    const timedOut = () => new Error(`Timed out waiting for project job ${jobId}; the server job may still be running`);
    // A stalled HTTP request must not keep a closed picker waiting. This only
    // stops the local wait; it deliberately does not cancel the server job.
    const getCancellableJob = () => new Promise<ProjectJob>((resolve, reject) => {
        let settled = false;
        const finish = (error?: unknown, job?: ProjectJob) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', stop);
            if (error) reject(error);
            else resolve(job);
        };
        const stop = () => finish(aborted());
        const timer = setTimeout(() => finish(timedOut()), Math.max(0, timeoutMs - (Date.now() - started)));
        signal?.addEventListener('abort', stop, { once: true });
        if (signal?.aborted) {
            stop();
            return;
        }
        try {
            Promise.resolve(getJob(jobId)).then(job => finish(undefined, job), error => finish(error));
        } catch (error) {
            finish(error);
        }
    });
    for (;;) {
        if (signal?.aborted) throw aborted();
        if (Date.now() - started >= timeoutMs) throw timedOut();
        const job = await getCancellableJob();
        if (signal?.aborted) throw aborted();
        if (!job || job.id !== jobId) throw new Error('Project job response does not match the requested job');
        if (job.status === 'complete') return job;
        if (job.status === 'error') throw new Error(job.messages?.join('\n') || `Project job ${jobId} failed`);
        if (!['running', 'queued', 'pending'].includes(job.status)) throw new Error(`Unexpected project job status: ${job.status}`);
        await new Promise<void>((resolve, reject) => {
            const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(aborted()); };
            const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, Math.min(intervalMs, Math.max(0, timeoutMs - (Date.now() - started))));
            signal?.addEventListener('abort', stop, { once: true });
            if (signal?.aborted) stop();
        });
    }
};
