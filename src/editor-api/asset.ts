import { Events, Observer, ObserverHistory } from '@playcanvas/observer';

import { withFontFileHashes } from '../common/font-file-url';

import { replace } from './assets/replace';
import type { Entity } from './entity';
import { globals as api } from './globals';
import type { TinyAppBuildOptions, TinyAppWaitOptions } from './tinyapps';
import { utils } from './utils';

/**
 * Represents an observer for an asset, extending the base Observer.
 */
export type AssetObserver = Observer & {
    /**
     * The API asset associated with this observer.
     */
    apiAsset: Asset;

    /**
     * The history of changes made to the observer.
     */
    history: ObserverHistory;
};

/**
 * The Asset class represents an asset in Editor.
 */
class Asset extends Events {
    private _observer: AssetObserver;

    private _suspendOnSet: boolean;

    private _history: ObserverHistory | object;

    /**
     * Constructor
     *
     * @param data - The asset data
     */
    constructor(data: any = {}) {
        super();

        // allow duplicate values in data.frameKeys of sprite asset
        let options = {};
        if (data.type === 'sprite') {
            options = {
                pathsWithDuplicates: ['data.frameKeys']
            };
        }

        data = Object.assign(
            {
                name: 'New Asset',
                tags: [],
                meta: null,
                data: null,
                file: null,
                path: []
            },
            data
        );

        this._observer = new Observer(data, options) as AssetObserver;
        this._observer.apiAsset = this;
        this._observer.addEmitter(this);

        this._observer.latestFn = () => {
            const latest = api.assets.get(this.get('id'));
            return latest && latest._observer;
        };

        this._resetThumbnailUrls();

        this._observer.on('has_thumbnail:set', this._resetThumbnailUrls.bind(this));

        // this can happen when the asset is created without a type because
        // the type is not yet available e.g. when listing Assets using the REST API
        // or when fields are set out of order e.g. has_thumbnail set before type
        if (!data.type) {
            this._observer.once('type:set', this._resetThumbnailUrls.bind(this));
        }

        this._suspendOnSet = false;
        this._observer.on('*:set', this._onSet.bind(this));

        this._history = {};
    }

    initializeHistory() {
        if (this._observer.history) {
            return;
        }

        this._history = new ObserverHistory({
            item: this._observer,
            prefix: `asset.${this.get('id')}.`,
            history: api.history
        });

        this._observer.history = this._history as ObserverHistory;
    }

    private _applyLocalChanges(callback: () => void) {
        const { sync, history } = this._observer;
        const syncEnabled = sync?.enabled;
        const historyEnabled = history?.enabled;
        if (sync) sync.enabled = false;
        if (history) history.enabled = false;
        try {
            callback();
        } finally {
            if (sync) sync.enabled = syncEnabled;
            if (history) history.enabled = historyEnabled;
        }
    }

    private _resetThumbnailUrls() {
        const type = this.get('type') || '';
        if (!type.startsWith('texture')) {
            return;
        }

        this._applyLocalChanges(() => {
            if (this.get('has_thumbnail')) {
                const id = this.get('id');
                this.set('thumbnails', {
                    s: `/api/assets/${id}/thumbnail/small?branchId=${api.branchId}`,
                    m: `/api/assets/${id}/thumbnail/medium?branchId=${api.branchId}`,
                    l: `/api/assets/${id}/thumbnail/large?branchId=${api.branchId}`,
                    xl: `/api/assets/${id}/thumbnail/xlarge?branchId=${api.branchId}`
                });
            } else {
                this.unset('thumbnails');
            }
        });
    }

    private _onSet(path: string, value: any) {
        if (this._suspendOnSet || !path.startsWith('file') || path.endsWith('.url') || !this.get('file')) {
            return;
        }

        this._suspendOnSet = true;

        try {
            // URLs are derived for this client's branch. Notify local consumers
            // without publishing them as document edits or undoable actions.
            this._applyLocalChanges(() => {
                const parts = path.split('.');
                if ((parts.length === 1 || parts.length === 2) && parts[1] !== 'variants') {
                    this.set('file.url', Asset.getFileUrl(this.get('id'), this.get('file.filename'), this.get('type') === 'font' ? this.get('file.url') : undefined));
                    this._resetThumbnailUrls();
                } else if (parts.length >= 3 && parts[1] === 'variants') {
                    const format = parts[2];
                    this.set(
                        `file.variants.${format}.url`,
                        Asset.getFileUrl(this.get('id'), this.get(`file.variants.${format}.filename`))
                    );
                }
            });
        } finally {
            this._suspendOnSet = false;
        }
    }

    /**
     * Checks if path exists. See the {@link Asset} overview for a full list of properties.
     *
     * @param path - The path
     * @returns True if path exists
     */
    has(path: string) {
        return this._observer.has(path);
    }

    /**
     * Gets value at path. See the {@link Asset} overview for a full list of properties.
     *
     * @param path - The path
     * @returns The value
     */
    get(path: string) {
        return this._observer.get(path);
    }

    /**
     * Sets value at path. See the {@link Asset} overview for a full list of properties.
     *
     * @param path - The path
     * @param value - The value
     * @returns Whether the value was set
     */
    set(path: string, value: any) {
        return this._observer.set(path, value);
    }

    /**
     * Unsets value at path. See the {@link Asset} overview for a full list of properties.
     *
     * @param path - The path
     * @returns Whether the value was unset
     */
    unset(path: string) {
        return this._observer.unset(path);
    }

    /**
     * Inserts value in array at path, at specified index. See the {@link Asset} overview for a
     * full list of properties.
     *
     * @param path - The path
     * @param value - The value
     * @param index - The index (if undefined the value will be inserted in the end)
     * @returns Whether the value was inserted
     */
    insert(path: any, value: any, index: any) {
        return this._observer.insert(path, value, index);
    }

    /**
     * Remove value from array at path. See the {@link Asset} overview for a full list of properties.
     *
     * @param path - The path
     * @param value - The value
     * @returns Whether the value was removed
     */
    removeValue(path: any, value: any) {
        return this._observer.removeValue(path, value);
    }

    /**
     * Returns JSON representation of entity data
     *
     * @returns - The data
     */
    json() {
        return this._observer.json();
    }

    /**
     * Returns the latest version of the Asset from the Assets API.
     *
     * @returns The asset
     */
    latest() {
        return api.assets.get(this._observer.get('id'));
    }

    /**
     * Loads asset from the server without subscribing to realtime changes.
     */
    async load() {
        const response = await fetch(`/api/assets/${this.get('id')}?branchId=${api.branchId}`);
        if (!response.ok) {
            throw new Error(`${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.file) {
            data.file.url = Asset.getFileUrl(data.id, data.file.filename, data.type === 'font' ? data.file.url : undefined);

            if (data.file.variants) {
                for (const key in data.file.variants) {
                    data.file.variants[key].url = Asset.getFileUrl(data.id, data.file.variants[key].filename);
                }
            }
        }

        this._applyLocalChanges(() => {
            for (const field in data) {
                this.set(field, data[field]);
            }
        });
    }

    /**
     * Loads the asset's data from sharedb and subscribes to changes.
     */
    async loadAndSubscribe() {
        if (!api.realtime) {
            return;
        }

        const uniqueId = this.get('uniqueId');
        const a = api.realtime.assets.load(uniqueId);
        await new Promise<void>((resolve, reject) => {
            a.once('load', () => {
                // RealtimeAsset.data is the live ShareDB snapshot. Local IDs and
                // URLs must not mutate it or alter later operation preconditions.
                const data = utils.deepCopy(a.data);

                data.id = parseInt(data.item_id ?? data.id, 10);
                data.uniqueId = uniqueId;
                data.createdAt = this.get('createdAt');

                // delete unnecessary fields
                delete data.item_id;
                delete data.branch_id;

                if (data.file) {
                    data.file.url = Asset.getFileUrl(data.id, data.file.filename, data.type === 'font' ? data.file.url : undefined);

                    if (data.file.variants) {
                        for (const key in data.file.variants) {
                            data.file.variants[key].url = Asset.getFileUrl(data.id, data.file.variants[key].filename);
                        }
                    }
                }

                this._applyLocalChanges(() => {
                    for (const field in data) {
                        this.set(field, data[field]);
                    }
                });

                resolve();
            });

            a.once('error:load', (err: any) => {
                reject(err);
            });
        });
    }

    /**
     * Deletes this asset.
     */
    async delete() {
        await api.assets.delete([this]);
    }

    /**
     * Creates an instance of this template asset. Assumes this asset is a template asset.
     *
     * @param parent - The parent entity
     * @param options.index - The desired index under the parent to instantiate the template.
     * @param options.history - Whether to record a history action.
     * @param options.select - Whether to select the new entity.
     * @param options.extraData - Extra data passed to the backend. Used by the Editor on specific cases.
     * @returns The new entity.
     */
    async instantiateTemplate(
        parent: Entity,
        options: { index?: number; history?: boolean; select?: boolean; extraData?: object } = {}
    ) {
        const entities = await api.assets.instantiateTemplates([this], parent, options);
        return entities[0];
    }

    /**
     * Inspects TinyApp packaging dependencies, scripts, child Templates, and warnings
     * for this Template asset.
     *
     * @param options - Optional branch override.
     * @returns Detailed TinyApp inspection metadata.
     */
    inspectTinyApp(options: { branchId?: string } = {}) {
        if (this.get('type') !== 'template') {
            throw new Error('TinyApp inspection is only available for template assets');
        }
        return api.tinyapps.inspect(Number(this.get('id')), options);
    }

    /**
     * Builds and publishes this Template asset as a TinyApp via backend cloud storage.
     *
     * @param options - Build and wait options (`wait: false` returns immediately after queuing).
     * @returns Queued or completed TinyApp build record.
     */
    buildTinyApp(options: TinyAppBuildOptions & TinyAppWaitOptions & { wait?: boolean } = {}) {
        if (this.get('type') !== 'template') {
            throw new Error('TinyApp packaging is only available for template assets');
        }
        const id = Number(this.get('id'));
        if (options.wait === false) {
            return api.tinyapps.build(id, options);
        }
        return api.tinyapps.buildAndWait(id, options);
    }

    /**
     * Lists historical TinyApp builds for this Template asset.
     *
     * @param options - Pagination and filter options.
     * @returns Paginated TinyApp build list.
     */
    listTinyAppBuilds(options: { branchId?: string; status?: string; skip?: number; limit?: number } = {}) {
        if (this.get('type') !== 'template') {
            throw new Error('TinyApp builds are only available for template assets');
        }
        return api.tinyapps.list(Number(this.get('id')), options);
    }

    /**
     * Exports a local troubleshooting `.zip` archive of this Template asset's TinyApp bundle.
     *
     * @param options - Archive export options.
     * @returns Archive filename and Blob.
     */
    downloadTinyAppArchive(options: TinyAppBuildOptions & { triggerBrowserDownload?: boolean } = {}) {
        if (this.get('type') !== 'template') {
            throw new Error('TinyApp archive export is only available for template assets');
        }
        return api.tinyapps.downloadTemplateArchive(Number(this.get('id')), options);
    }

    /**
     * Replaces any references to this asset with references to the new asset specified.
     *
     * @param asset - The new asset.
     * @param options.history - Whether to record a history action.
     */
    replace(asset: Asset, options: { history?: boolean } = {}) {
        replace(this, asset, options);
    }

    /**
     * The observer object for this asset.
     */
    get observer() {
        return this._observer;
    }

    /**
     * Gets observer history for this asset.
     */
    get history() {
        return this._history as ObserverHistory;
    }

    /**
     * Gets the file URL for an asset file.
     *
     * @param id - The asset id
     * @param filename - The desired filename
     * @returns The file URL
     */
    static getFileUrl(id: number, filename: string, fontFileUrl?: string) {
        return withFontFileHashes(`/api/assets/${id}/file/${encodeURIComponent(filename)}?branchId=${api.branchId}`, fontFileUrl);
    }
}

export { Asset };
