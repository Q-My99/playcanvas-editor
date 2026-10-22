import { resolveConflictMode } from '@/code-editor/config';

editor.once('load', () => {
    // Conflict buffers belong only to immutable merge artifacts, never live documents.
    if (resolveConflictMode) {
        return;
    }

    const validTypes = ['css', 'folder', 'html', 'json', 'script', 'shader', 'text'];

    // create new asset
    editor.on('messenger:asset.new', (data: unknown) => {
        if (data.asset.branchId !== config.self.branch.id) {
            return;
        }

        const uniqueId = data.asset.id;

        if (data.asset.source === false && data.asset.status && data.asset.status !== 'complete') {
            return;
        }

        if (validTypes.indexOf(data.asset.type) === -1) {
            return;
        }

        const asset = editor.call('assets:getUnique', uniqueId);
        if (!asset) {
            editor.call('assets:loadOne', uniqueId);
        }
    });

    editor.on('messenger:project.resync', (data: { assets: { id: number; branchId: string; type: string }[] }) => {
        const assets = data.assets.filter(asset => asset.branchId === config.self.branch.id && validTypes.includes(asset.type));
        const ids = new Set(assets.map(asset => String(asset.id)));
        for (const asset of editor.call('assets:list')) {
            if (!ids.has(String(asset.get('uniqueId')))) editor.call('assets:remove', asset);
        }
        for (const asset of assets) {
            if (!editor.call('assets:getUnique', asset.id)) editor.call('assets:loadOne', asset.id);
        }
    });

    // remove
    editor.on('messenger:asset.delete', (data: unknown) => {
        const asset = editor.call('assets:getUnique', data.asset.id);
        if (!asset) {
            return;
        }
        editor.call('assets:remove', asset);
    });

    // remove multiple
    editor.on('messenger:assets.delete', (data: unknown) => {
        for (let i = 0; i < data.assets.length; i++) {
            const assetId = data.assets[i];
            const asset = editor.call('assets:getUnique', parseInt(assetId, 10));
            if (!asset) {
                continue;
            }
            editor.call('assets:remove', asset);
        }
    });
});
