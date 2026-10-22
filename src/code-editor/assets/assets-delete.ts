import type { Observer } from '@playcanvas/observer';

import { resolveConflictMode } from '@/code-editor/config';


editor.once('load', () => {
    // Conflict buffers belong only to immutable merge artifacts, never live documents.
    if (resolveConflictMode) {
        return;
    }

    editor.method('assets:delete:picker', (items: Observer[]) => {
        if (!editor.call('permissions:write')) {
            return;
        }

        let msg = 'Delete Asset?';

        if (items.length === 1 && items[0].get('type') === 'folder') {
            msg = 'Delete Folder?';
        }

        if (items.length > 1) {
            msg = `Delete ${items.length} Assets?`;
        }

        editor.call(
            'picker:confirm',
            msg,
            () => {
                if (!editor.call('permissions:write')) {
                    return;
                }

                editor.call('assets:fs:delete', items);
            },
            {
                yesText: 'Delete',
                noText: 'Cancel'
            }
        );
    });
});
