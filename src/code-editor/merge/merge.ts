import { resolveConflictMode } from '../config';

editor.once('load', () => {
    if (resolveConflictMode) {
        const root = editor.call('layout.root');
        root.class.add('file-only-mode');
    }

    editor.method('editor:resolveConflictMode', () => {
        return resolveConflictMode;
    });
});
