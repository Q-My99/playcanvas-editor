/** Preserve validated font bundle hashes while rebasing a server URL to this client's API. */
export const withFontFileHashes = (url: string, sourceUrl?: string) => {
    const query = new URLSearchParams(sourceUrl?.split('?')[1]?.split('#')[0] ?? '');
    for (const key of ['hash', 'fontHash']) {
        const value = query.get(key);
        if (value && /^[a-f0-9]{64}$/.test(value)) url += `&${key}=${value}`;
    }
    return url;
};
