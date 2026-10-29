const KEEPALIVE_INTERVAL_MS = 15 * 60 * 1000;
const MIN_CHECK_GAP_MS = 60 * 1000;
const AUTH_CLOSE_REASONS = new Set([
    'Session expired',
    'Authentication required',
    'Authentication failed',
    'Account credentials changed; reconnect'
]);

editor.once('load', () => {
    if (!config.selfhost || config.selfhost.previewSettings || !config.url?.api) {
        return;
    }

    let lastCheckedAt = Date.now();
    let checking = false;
    let handledUnauthorized = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopTimer = () => {
        if (timer !== null) {
            clearInterval(timer);
            timer = null;
        }
    };

    const onUnauthorized = () => {
        if (handledUnauthorized) {
            return;
        }
        handledUnauthorized = true;
        stopTimer();

        const hasMergeBuffer = 'merge' in config.self.branch && Boolean(config.self.branch.merge);
        if (editor.isCodeEditor && (hasMergeBuffer || Boolean(document.querySelector('.tab.dirty')))) {
            editor.call(
                'status:permanentError',
                'Your session has expired. Copy any unsaved changes, then refresh to sign in.'
            );
            return;
        }

        const path = window.location.pathname;
        const current = `${path}${window.location.search}${window.location.hash}`;
        const target =
            path === '/editor' || path === '/editor/' ? '/login' : `/login?next=${encodeURIComponent(current)}`;
        window.location.assign(target);
    };

    const checkSession = async (force = false) => {
        const now = Date.now();
        if (checking || handledUnauthorized || (!force && now - lastCheckedAt < MIN_CHECK_GAP_MS)) {
            return;
        }
        checking = true;
        lastCheckedAt = now;
        try {
            const response = await fetch(`${config.url.api}/auth/me`, {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'application/json' }
            });
            if (response.status === 401) {
                onUnauthorized();
            }
        } catch {
            // Transient network failures are handled by normal realtime reconnection.
        } finally {
            checking = false;
        }
    };

    editor.method('auth:check', () => {
        void checkSession(true);
    });

    editor.on('realtime:disconnected', (reason?: unknown) => {
        if (
            reason &&
            typeof reason === 'object' &&
            'code' in reason &&
            reason.code === 1008 &&
            'reason' in reason &&
            typeof reason.reason === 'string' &&
            AUTH_CLOSE_REASONS.has(reason.reason)
        ) {
            void checkSession(true);
        }
    });

    timer = setInterval(() => {
        void checkSession(true);
    }, KEEPALIVE_INTERVAL_MS);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            void checkSession(false);
        }
    });
    window.addEventListener('pageshow', () => {
        void checkSession(false);
    });
    window.addEventListener('online', () => {
        void checkSession(false);
    });
    window.addEventListener('pagehide', stopTimer);
});
