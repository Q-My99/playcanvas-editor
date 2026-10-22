import { config } from '@/editor/config';
import { getUniqueName } from '@/editor-api/assets/unique-name';

const TEXT_TYPES = new Set(['css', 'html', 'json', 'text', 'shader']);
// types we can recreate client-side without re-uploading file blobs
const CLIENT_PASTE_TYPES = new Set([...TEXT_TYPES, 'folder']);
type PasteCallback = (error: string | null, response?: unknown) => void;
type PasteClipboard = { projectId: unknown; branchId: unknown; assets: unknown };
type PasteFolder = { get: (path: string) => unknown };
type PasteResponse = { result: { id: number }[] };

const businessId = (value: unknown): number | null => {
    if (
        (typeof value !== 'number' && typeof value !== 'string') ||
        !/^[1-9]\d*$/.test(String(value))
    ) {
        return null;
    }
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
};

const sameId = (a: string | number | null | undefined, b: string | number | null | undefined) => {
    if (a === null || a === undefined || b === null || b === undefined) {
        return (a ?? null) === (b ?? null);
    }
    return `${a}` === `${b}`;
};

editor.once('load', () => {
    let pasteSequence = 0;
    let pendingTreePaste: {
        key: string;
        jobId: string;
        projectId: number;
        branchId: string;
        callbacks: PasteCallback[];
    } | null = null;

    // This capability delegates the complete selection to one server transaction.
    // Do not partition by type, inspect local descendants, or fall back to recreation:
    // the server owns recursive discovery, reference remapping, names and publication.
    const pasteAssetTree = (
        value: PasteClipboard,
        parentFolder: PasteFolder | null,
        keepFolderStructure?: boolean,
        callback?: PasteCallback
    ) => {
        const projectId = businessId(value.projectId);
        const targetProjectId = businessId(config.project.id);
        const targetBranchId = config.self.branch.id;
        const supportsCrossScopeCopy = config.selfhost?.assetCopy === 'closure-v1';
        const targetFolderId = parentFolder ? businessId(parentFolder.get('id')) : null;
        const rawIds = Array.isArray(value.assets) ? value.assets : [];
        const ids = rawIds.map(businessId);
        const fail = (message: string) => {
            editor.call('status:error', message);
            callback?.(message);
        };
        if (
            projectId === null || targetProjectId === null ||
            typeof value.branchId !== 'string' || !value.branchId ||
            typeof targetBranchId !== 'string' || !targetBranchId ||
            !ids.length || ids.some((id) => id === null) ||
            (parentFolder && (targetFolderId === null || parentFolder.get('type') !== 'folder'))
        ) {
            fail('The asset clipboard or destination is invalid. Copy the assets again and choose a folder.');
            return;
        }

        // Clipboard IDs are business IDs, not realtime unique IDs. A bad member
        // rejects the entire selection rather than quietly dropping that member.
        const assets: string[] = [...new Set(ids.map((id) => String(id)))];
        const data = {
            projectId,
            branchId: value.branchId as string,
            targetProjectId,
            targetBranchId,
            targetFolderId,
            keepFolderStructure: keepFolderStructure !== false,
            assets
        };
        const key = JSON.stringify({ ...data, assets: [...assets].sort() });
        const isCurrentContext = (operation: { projectId: number; branchId: string }) =>
            sameId(config.project.id, operation.projectId) && config.self.branch.id === operation.branchId;

        if (pendingTreePaste && isCurrentContext(pendingTreePaste)) {
            if (pendingTreePaste.key === key) {
                if (callback) {
                    pendingTreePaste.callbacks.push(callback);
                }
            } else {
                fail('An asset paste is already in progress. Wait for it to finish before pasting again.');
            }
            return;
        }

        const operation = {
            key,
            jobId: `asset-paste-tree:${++pasteSequence}`,
            projectId: targetProjectId,
            branchId: targetBranchId,
            callbacks: callback ? [callback] : []
        };
        pendingTreePaste = operation;
        editor.call('status:text', 'Pasting assets...');
        editor.call('status:job', operation.jobId, 1);
        let settled = false;
        const complete = (error: string | null, response?: PasteResponse) => {
            if (settled) {
                return;
            }
            settled = true;
            editor.call('status:job', operation.jobId);
            // A branch/project change can leave an HTTP request in flight. Its
            // result must not change the new context's status or invoke old callbacks.
            const current = pendingTreePaste === operation && isCurrentContext(operation);
            if (pendingTreePaste === operation) {
                pendingTreePaste = null;
            }
            if (!current) {
                return;
            }
            if (error) {
                editor.call('status:error', error);
            } else if (response) {
                const total = response.result.length;
                editor.call('status:text', `${total} asset${total > 1 ? 's' : ''} created`);
            }
            for (const done of operation.callbacks) {
                done(error, response);
            }
        };
        // The status sink accepts HTML. Use fixed local messages, never raw server
        // errors, HTML, stack traces or paths; an unknown result may have committed.
        const failed = (status?: number) => {
            let message = 'Asset paste did not complete. Refresh to check the result before trying again.';
            if (status === 403) {
                message = 'You do not have permission to paste these assets.';
            } else if (status === 404) {
                message = 'A source asset or destination folder no longer exists. Refresh and try again.';
            } else if (status === 409) {
                message = 'The asset tree changed while pasting. Refresh and try again.';
            } else if (status === 422) {
                if (!sameId(projectId, targetProjectId) || data.branchId !== targetBranchId) {
                    message = supportsCrossScopeCopy ?
                        'This asset selection cannot be pasted safely. Some asset, dependency, or reference conversions are not supported on this server.' :
                        'Pasting assets across projects or branches is not supported on this server.';
                } else {
                    message = 'This asset selection cannot be pasted safely on this server.';
                }
            }
            complete(message);
        };
        try {
            editor.api.globals.rest.assets
                .assetPaste(data)
                .on('load', (status: number, response: PasteResponse) => {
                    const result = response?.result;
                    if (
                        status !== 201 || !Array.isArray(result) || !result.length ||
                        result.length > assets.length ||
                        result.some((item) => !item || businessId(item.id) === null) ||
                        new Set(result.map((item) => String(item.id))).size !== result.length
                    ) {
                        failed();
                        return;
                    }
                    complete(null, response);
                })
                .on('error', (status: number) => failed(status));
        } catch (_) {
            failed();
        }
    };

    // get direct children of a folder (or root when folderId === null)
    const childrenOf = (folderId: string | number | null) => {
        return editor.call('assets:list').filter((a: any) => {
            const p = a.get('path');
            const par = p && p.length ? p[p.length - 1] : null;
            return sameId(par, folderId);
        });
    };

    // build the set of names already in use within a folder (sans optional self)
    const takenIn = (folderId: string | number | null, exceptId?: string | number) => {
        const taken = new Set<string>();
        for (const a of childrenOf(folderId)) {
            if (exceptId !== undefined && sameId(a.get('id'), exceptId)) {
                continue;
            }
            taken.add(a.get('name'));
        }
        return taken;
    };

    // fetch a text asset's file contents via REST
    const fetchTextContent = (asset: any) =>
        new Promise<string>((resolve, reject) => {
            const filename = asset.get('file.filename');
            if (!filename) {
                resolve('');
                return;
            }
            editor.api.globals.rest.assets
                .assetGetFile(asset.get('id'), filename, { branchId: config.self.branch.id })
                .on('load', (_status: number, data: unknown) => {
                    resolve(typeof data === 'string' ? data.replace(/\r\n?/g, '\n') : '');
                })
                .on('error', (_status: number, err: unknown) => reject(err));
        });

    // create one asset under targetFolder mirroring source. returns the newly
    // created Asset (editor-api object) so callers can recurse into folders.
    const pasteOne = async (
        source: any,
        targetFolderApi: any,
        targetFolderId: string | number | null
    ): Promise<any> => {
        const type = source.get('type');
        const desired = source.get('name');
        const taken = takenIn(targetFolderId);
        const uniqueName = getUniqueName(desired, taken);

        if (TEXT_TYPES.has(type)) {
            const text = await fetchTextContent(source);
            if (type === 'json') {
                let parsed: object;
                try {
                    parsed = text ? JSON.parse(text) : {};
                } catch (_) {
                    parsed = {};
                }
                return editor.api.globals.assets.createJson({
                    name: uniqueName,
                    json: parsed,
                    folder: targetFolderApi
                });
            }
            const method = `create${type[0].toUpperCase()}${type.slice(1)}` as
                'createCss' | 'createHtml' | 'createText' | 'createShader';
            return editor.api.globals.assets[method]({
                name: uniqueName,
                text,
                folder: targetFolderApi
            });
        }

        if (type === 'folder') {
            return editor.api.globals.assets.createFolder({
                name: uniqueName,
                folder: targetFolderApi
            });
        }

        return null;
    };

    // recursively paste a folder's children into the new folder. siblings
    // share a target folder, so resolve them sequentially — otherwise two
    // children with identical names could both win the same getUniqueName slot.
    const pasteFolderChildren = async (sourceFolder: any, newFolder: any) => {
        const sourceId = sourceFolder.get('id');
        const newFolderId = newFolder.get('id');
        const newFolderObserver = editor.call('assets:get', newFolderId);
        const newFolderApi = newFolderObserver?.apiAsset ?? newFolder;

        for (const child of childrenOf(sourceId)) {
            if (!CLIENT_PASTE_TYPES.has(child.get('type'))) {
                continue;
            }

            const created = await pasteOne(child, newFolderApi, newFolderId);
            if (created && child.get('type') === 'folder') {
                await pasteFolderChildren(child, created);
            }
        }
    };

    // wait for the asset to land in the local registry, then suffix its name (and
    // file.filename for text-based files) if a sibling already uses it. used as
    // a fallback when we delegate to the server-side REST paste (cross-project,
    // binary types, etc.)
    const ensureUniqueOnPaste = (assetId: string | number, targetFolderId: string | number | null) => {
        const apply = () => {
            const asset = editor.call('assets:get', assetId);
            if (!asset) {
                return;
            }
            const path = asset.get('path');
            const parentId = path && path.length ? path[path.length - 1] : null;
            if (!sameId(parentId, targetFolderId)) {
                return;
            }
            const type = asset.get('type');
            const enforce = TEXT_TYPES.has(type) || type === 'folder' || type === 'script';
            if (!enforce) {
                return;
            }

            const taken = takenIn(targetFolderId, assetId);
            const currentName = asset.get('name');
            if (!taken.has(currentName)) {
                return;
            }
            const newName = getUniqueName(currentName, taken);
            const update: { name: string; filename?: string } = { name: newName };
            if (asset.get('file.filename')) {
                update.filename = newName;
            }
            editor.api.globals.rest.assets
                .assetUpdate(String(assetId), update)
                .on('error', (_status: number, errData: unknown) => {
                    console.warn(`paste rename error: ${errData}`);
                });
        };

        if (editor.call('assets:get', assetId)) {
            apply();
        } else {
            editor.once(`assets:add[${assetId}]`, apply);
        }
    };

    editor.method('assets:paste', (parentFolder, keepFolderStructure, callback) => {
        if (!editor.call('permissions:write')) {
            return;
        }

        const clipboard = editor.call('clipboard');
        const value = clipboard.value;
        if (!value || value.type !== 'asset') {
            return;
        }

        if (config.selfhost?.assetTree === 'generation-v1') {
            pasteAssetTree(value, parentFolder, keepFolderStructure, callback);
            return;
        }

        const targetFolderObserver = parentFolder ?? null;
        const targetFolderId = targetFolderObserver ? targetFolderObserver.get('id') : null;
        const targetFolderApi = targetFolderObserver?.apiAsset ?? undefined;
        const sameProject = value.projectId === config.project.id && value.branchId === config.self.branch.id;

        // partition source asset IDs into client-side and server-side groups
        const clientIds: string[] = [];
        const serverIds: string[] = [];

        if (sameProject) {
            for (const id of value.assets) {
                const source = editor.call('assets:get', id);
                if (source && CLIENT_PASTE_TYPES.has(source.get('type'))) {
                    clientIds.push(id);
                } else {
                    serverIds.push(id);
                }
            }
        } else {
            serverIds.push(...value.assets);
        }

        const now = Date.now();
        editor.call('status:text', 'Pasting assets...');
        editor.call('status:job', `asset-paste:${now}`, 1);

        const finishJob = () => editor.call('status:job', `asset-paste:${now}`);

        const runClientSide = async () => {
            for (const id of clientIds) {
                const source = editor.call('assets:get', id);
                if (!source) {
                    continue;
                }

                const created = await pasteOne(source, targetFolderApi, targetFolderId);
                if (created && source.get('type') === 'folder' && keepFolderStructure !== false) {
                    await pasteFolderChildren(source, created);
                }
            }
        };

        const runServerSide = () =>
            new Promise<any>((resolve, reject) => {
                if (serverIds.length === 0) {
                    resolve(null);
                    return;
                }
                const data: any = {
                    projectId: value.projectId,
                    branchId: value.branchId,
                    targetProjectId: config.project.id,
                    targetBranchId: config.self.branch.id,
                    keepFolderStructure: !!keepFolderStructure,
                    assets: serverIds.slice()
                };
                if (parentFolder) {
                    data.targetFolderId = parentFolder.get('id');
                }
                editor.api.globals.rest.assets
                    .assetPaste(data)
                    .on('load', (status: number, response: any) => {
                        if (status === 201 && Array.isArray(response.result)) {
                            for (let i = 0; i < response.result.length; i++) {
                                const item = response.result[i];
                                const id = item?.id ?? item;
                                if (id !== undefined && id !== null) {
                                    ensureUniqueOnPaste(id, targetFolderId);
                                }
                            }
                        }
                        resolve(response);
                    })
                    .on('error', (_status: number, err: unknown) => reject(err));
            });

        runClientSide()
            .then(() => runServerSide())
            .then((response) => {
                const total = clientIds.length + (response?.result?.length ?? 0);
                if (total > 0) {
                    editor.call('status:text', `${total} asset${total > 1 ? 's' : ''} created`);
                } else {
                    editor.call('status:clear');
                }
                finishJob();
                if (callback) {
                    callback(null, response);
                }
            })
            .catch((err) => {
                editor.call('status:error', err ?? 'Error while pasting assets');
                finishJob();
                if (callback) {
                    callback(err);
                }
            });
    });
});
