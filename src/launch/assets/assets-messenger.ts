editor.once('load', () => {
    const validRuntimeAssets = new Set([
        'animation',
        'audio',
        'font',
        'container',
        'cubemap',
        'css',
        'gsplat',
        'html',
        'json',
        'material',
        'model',
        'render',
        'scene',
        'script',
        'sprite',
        'text',
        'texture',
        'textureatlas'
    ]);

    const create = (data: { asset: { id: number; source?: boolean; type: string; status?: string } }) => {
        const { asset } = data;

        // ignore if not a runtime asset, or source asset, or not yet complete
        if (asset.source || !validRuntimeAssets.has(asset.type) || (asset.status && asset.status !== 'complete')) {
            return;
        }

        const uniqueId = Number(asset.id);
        if (!uniqueId) {
            return;
        }

        editor.call('loadAsset', uniqueId);
    };

    // create or update
    editor.on('messenger:asset.new', create);
    editor.on('messenger:project.resync', (data: { assets: { id: number; branchId: string; source?: boolean; type: string; status?: string }[] }) => {
        const assets = data.assets.filter(asset => asset.branchId === config.self.branch.id);
        const ids = new Set(assets.map(asset => String(asset.id)));
        for (const asset of editor.call('assets:list')) {
            if (!ids.has(String(asset.get('uniqueId')))) editor.call('assets:remove', asset);
        }
        for (const asset of assets) {
            if (!editor.call('assets:getUnique', Number(asset.id))) create({ asset });
        }
    });

    // remove
    editor.on('messenger:asset.delete', (data: { asset: { id: number } }) => {
        const asset = editor.call('assets:getUnique', data.asset.id);
        if (asset) {
            editor.call('assets:remove', asset);
        }
    });

    // remove multiple
    editor.on('messenger:assets.delete', (data: { assets: (string | number)[] }) => {
        data.assets.forEach((id: string | number) => {
            const asset = editor.call('assets:getUnique', Number(id));
            if (asset) {
                editor.call('assets:remove', asset);
            }
        });
    });
});
