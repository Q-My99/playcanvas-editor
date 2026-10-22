import type { CodeEditorConfig } from '@/editor-api';

export const config = window.config as CodeEditorConfig;

// Capture the server-authorized mode before any load listeners run. In particular,
// realtime is initialized before the merge layout listener in the normal bundle.
export const resolveConflictMode = !!(config.self.branch.merge && 'conflict' in config.self.branch.merge && config.self.branch.merge.conflict);
