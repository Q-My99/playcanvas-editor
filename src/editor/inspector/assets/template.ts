import type { EventHandle, Observer } from '@playcanvas/observer';
import { Button, Container, Label, Panel, SelectInput, TextInput } from '@playcanvas/pcui';

import { bytesToHuman, convertDatetime } from '@/common/utils';
import { config } from '@/editor/config';
import type {
    TinyAppBuildRecord,
    TinyAppChildStrategy,
    TinyAppInspectResult
} from '@/editor-api/tinyapps';

const CLASS_ROOT = 'template-tinyapp-inspector';

function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    return Promise.resolve();
}

function flashButtonText(btn: Button, feedbackText: string, restoreText: string) {
    btn.text = feedbackText;
    setTimeout(() => {
        if (!btn.destroyed) {
            btn.text = restoreText;
        }
    }, 1400);
}

class TemplateAssetInspector extends Panel {
    private _asset: Observer | null = null;

    private _assetEvents: EventHandle[] = [];

    private _loadSeq = 0;

    private _busy = false;

    private _inspectData: TinyAppInspectResult | null = null;

    private _statusBadge: Label;

    private _summaryLabel: Label;

    private _latestUrlCard: Container;

    private _latestUrlText: Label;

    private _btnCopyLatest: Button;

    private _warningsBox: Container;

    private _labelInput: TextInput;

    private _childStrategyRow: Container;

    private _childStrategySelect: SelectInput;

    private _childHintLabel: Label;

    private _btnBuildPublish: Button;

    private _btnDownloadZip: Button;

    private _feedbackLabel: Label;

    private _historyTitleLabel: Label;

    private _btnRefreshHistory: Button;

    private _btnOpenManager: Button;

    private _historyList: Container;

    constructor(args: Record<string, unknown> = {}) {
        const panelArgs = Object.assign({}, args, {
            headerText: 'TINYAPP',
            collapsible: true
        });
        super(panelArgs);
        this.class.add(CLASS_ROOT);

        // 1. Overview strip (status badge + dependency summary)
        const overviewRow = new Container({
            flex: true,
            flexDirection: 'row',
            class: `${CLASS_ROOT}-overview`
        });
        this._statusBadge = new Label({
            text: '检查中...',
            class: `${CLASS_ROOT}-badge`
        });
        this._summaryLabel = new Label({
            text: '',
            class: `${CLASS_ROOT}-summary`
        });
        overviewRow.append(this._statusBadge);
        overviewRow.append(this._summaryLabel);
        this.append(overviewRow);

        // Latest URL bar
        this._latestUrlCard = new Container({
            flex: true,
            flexDirection: 'column',
            class: `${CLASS_ROOT}-url-card`,
            hidden: true
        });
        const urlTopRow = new Container({
            flex: true,
            flexDirection: 'row',
            class: `${CLASS_ROOT}-url-header`
        });
        urlTopRow.append(
            new Label({
                text: '线上最新地址',
                class: `${CLASS_ROOT}-section-caption`
            })
        );
        this._btnCopyLatest = new Button({
            text: '复制链接',
            size: 'small',
            class: `${CLASS_ROOT}-copy-btn`
        });
        this._btnCopyLatest.on('click', () => {
            const url = this._inspectData?.latestBuild?.publicUrl;
            if (!url) return;
            void copyToClipboard(url).then(() => flashButtonText(this._btnCopyLatest, '已复制', '复制链接'));
        });
        urlTopRow.append(this._btnCopyLatest);
        this._latestUrlText = new Label({
            text: '',
            allowTextSelection: true,
            class: `${CLASS_ROOT}-url-value`
        });
        this._latestUrlCard.append(urlTopRow);
        this._latestUrlCard.append(this._latestUrlText);
        this.append(this._latestUrlCard);

        // Compatibility warnings callout
        this._warningsBox = new Container({
            flex: true,
            flexDirection: 'column',
            class: `${CLASS_ROOT}-warnings`,
            hidden: true
        });
        this.append(this._warningsBox);

        // 2. Build & Export controls
        const controlsCard = new Container({
            flex: true,
            flexDirection: 'column',
            class: `${CLASS_ROOT}-controls`
        });

        const noteRow = new Container({
            flex: true,
            flexDirection: 'row',
            class: `${CLASS_ROOT}-field-row`
        });
        noteRow.append(new Label({ text: '版本备注', class: `${CLASS_ROOT}-field-label` }));
        this._labelInput = new TextInput({
            placeholder: '可选，如：调整动画节奏',
            keyChange: true,
            renderChanges: false,
            class: `${CLASS_ROOT}-field-control`
        });
        if (this._labelInput.input) {
            this._labelInput.input.placeholder = '可选，如：调整动画节奏';
            this._labelInput.input.setAttribute('aria-label', '版本备注');
        }
        noteRow.append(this._labelInput);
        controlsCard.append(noteRow);

        this._childStrategyRow = new Container({
            flex: true,
            flexDirection: 'column',
            class: `${CLASS_ROOT}-nested-box`,
            hidden: true
        });
        const strategyTop = new Container({
            flex: true,
            flexDirection: 'row',
            class: `${CLASS_ROOT}-field-row`
        });
        strategyTop.append(new Label({ text: '子模板策略', class: `${CLASS_ROOT}-field-label` }));
        this._childStrategySelect = new SelectInput({
            value: 'reuse-if-unchanged',
            options: [
                { v: 'reuse-if-unchanged', t: '未改动时自动复用 (推荐)' },
                { v: 'reuse-latest', t: '直接复用已发布最新版' },
                { v: 'force-rebuild', t: '全部重新构建发布' }
            ],
            class: `${CLASS_ROOT}-field-control`
        });
        strategyTop.append(this._childStrategySelect);
        this._childHintLabel = new Label({
            text: '',
            class: `${CLASS_ROOT}-nested-hint`
        });
        this._childStrategyRow.append(strategyTop);
        this._childStrategyRow.append(this._childHintLabel);
        controlsCard.append(this._childStrategyRow);

        const actionsRow = new Container({
            flex: true,
            flexDirection: 'row',
            class: `${CLASS_ROOT}-actions`
        });
        this._btnBuildPublish = new Button({
            text: '构建并发布',
            icon: 'E227',
            class: `${CLASS_ROOT}-btn-primary`
        });
        this._btnDownloadZip = new Button({
            text: '下载 ZIP',
            icon: 'E228',
            class: `${CLASS_ROOT}-btn-secondary`
        });
        this._btnDownloadZip.dom.title = '导出当前 Template 的本地 TinyApp 压缩包（用于离线排查，不写入线上记录）';
        this._btnBuildPublish.on('click', () => {
            void this._onBuildAndPublish();
        });
        this._btnDownloadZip.on('click', () => {
            void this._onDownloadTemplateZip();
        });
        actionsRow.append(this._btnBuildPublish);
        actionsRow.append(this._btnDownloadZip);
        controlsCard.append(actionsRow);

        this._feedbackLabel = new Label({
            text: '',
            allowTextSelection: true,
            class: `${CLASS_ROOT}-feedback`,
            hidden: true
        });
        controlsCard.append(this._feedbackLabel);
        this.append(controlsCard);

        // 3. Historical versions section
        const historyHeader = new Container({
            flex: true,
            flexDirection: 'row',
            class: `${CLASS_ROOT}-history-header`
        });
        this._historyTitleLabel = new Label({
            text: '历史版本',
            class: `${CLASS_ROOT}-history-title`
        });
        const historyActions = new Container({
            flex: true,
            flexDirection: 'row',
            class: `${CLASS_ROOT}-history-header-actions`
        });
        this._btnRefreshHistory = new Button({
            text: '刷新',
            size: 'small',
            class: `${CLASS_ROOT}-ghost-btn`
        });
        this._btnOpenManager = new Button({
            text: '管理页',
            size: 'small',
            class: `${CLASS_ROOT}-ghost-btn`
        });
        this._btnOpenManager.dom.title = '打开当前工程的 TinyApp 版本管理页面';
        this._btnRefreshHistory.on('click', () => {
            void this._refreshAll();
        });
        this._btnOpenManager.on('click', () => {
            const projectId = config.project?.id;
            if (projectId) {
                window.open(`/project/${projectId}/tinyapps`, '_blank', 'noopener,noreferrer');
            }
        });
        historyActions.append(this._btnRefreshHistory);
        historyActions.append(this._btnOpenManager);
        historyHeader.append(this._historyTitleLabel);
        historyHeader.append(historyActions);
        this.append(historyHeader);

        this._historyList = new Container({
            flex: true,
            flexDirection: 'column',
            class: `${CLASS_ROOT}-history-list`
        });
        this.append(this._historyList);
    }

    private _setFeedback(text: string, tone: 'info' | 'success' | 'error' = 'info') {
        this._feedbackLabel.class.remove('is-error', 'is-success');
        if (!text) {
            this._feedbackLabel.hidden = true;
            this._feedbackLabel.text = '';
            return;
        }
        if (tone === 'error') this._feedbackLabel.class.add('is-error');
        if (tone === 'success') this._feedbackLabel.class.add('is-success');
        this._feedbackLabel.text = text;
        this._feedbackLabel.hidden = false;
    }

    private _syncButtonStates() {
        const canWrite = Boolean(editor.call('permissions:write'));
        const cloudEnabled = Boolean(this._inspectData?.service?.enabled);
        this._btnBuildPublish.enabled = !this._busy && canWrite && cloudEnabled;
        if (!cloudEnabled) {
            this._btnBuildPublish.dom.title = '服务端未配置 TINYAPP_S3_*，请使用下载 ZIP 或 pcbridge 本地插件';
        } else if (!canWrite) {
            this._btnBuildPublish.dom.title = '当前账号仅有只读权限，无法发布新版本';
        } else {
            this._btnBuildPublish.dom.title = '在服务端转译 ES5 脚本并直传 OSS/COS CDN';
        }
        this._btnDownloadZip.enabled = !this._busy && Boolean(this._asset);
        this._btnRefreshHistory.enabled = !this._busy;
    }

    private async _refreshAll() {
        if (!this._asset) return;
        const assetId = Number(this._asset.get('id'));
        if (!assetId || !editor.api.globals.tinyapps?.isSupported()) return;

        const seq = ++this._loadSeq;
        try {
            const [inspectRes, listRes] = await Promise.all([
                editor.api.globals.tinyapps.inspect(assetId),
                editor.api.globals.tinyapps.list(assetId, { limit: 20 })
            ]);
            if (seq !== this._loadSeq || !this._asset) return;
            this._inspectData = inspectRes;
            this._renderInspect(inspectRes);
            this._renderHistory(listRes.result, listRes.pagination.total);
            this._syncButtonStates();
        } catch (error) {
            if (seq !== this._loadSeq) return;
            const msg = error instanceof Error ? error.message : String(error);
            this._statusBadge.text = '加载失败';
            this._setFeedback(`读取 TinyApp 信息失败：${msg}`, 'error');
        }
    }

    private _renderInspect(info: TinyAppInspectResult) {
        this._statusBadge.class.remove('is-synced', 'is-dirty', 'is-local');
        if (!info.service.enabled) {
            this._statusBadge.text = '仅本地导出';
            this._statusBadge.class.add('is-local');
        } else if (!info.latestBuild) {
            this._statusBadge.text = '尚未发布';
        } else if (info.hasUnbuiltChanges) {
            this._statusBadge.text = `有未发布修改 · 线上 v${info.latestBuild.version}`;
            this._statusBadge.class.add('is-dirty');
        } else {
            this._statusBadge.text = `已同步 v${info.latestBuild.version}`;
            this._statusBadge.class.add('is-synced');
        }

        const summaryParts = [
            `${info.assets.length} 资源`,
            `${info.scripts.length} 脚本`
        ];
        if (info.children.length > 0) {
            summaryParts.push(`${info.children.length} 子模板`);
        }
        this._summaryLabel.text = summaryParts.join(' · ');

        if (info.latestBuild?.publicUrl) {
            this._latestUrlText.text = info.latestBuild.publicUrl;
            this._latestUrlText.dom.title = info.latestBuild.publicUrl;
            this._latestUrlCard.hidden = false;
        } else {
            this._latestUrlCard.hidden = true;
        }

        this._warningsBox.clear();
        if (info.warnings.length > 0) {
            this._warningsBox.append(
                new Label({
                    text: `小程序兼容性提示 (${info.warnings.length})`,
                    class: `${CLASS_ROOT}-warnings-title`
                })
            );
            for (const warning of info.warnings) {
                this._warningsBox.append(
                    new Label({
                        text: `• ${warning}`,
                        allowTextSelection: true,
                        class: `${CLASS_ROOT}-warning-item`
                    })
                );
            }
            this._warningsBox.hidden = false;
        } else {
            this._warningsBox.hidden = true;
        }

        if (info.children.length > 0) {
            const reusableCount = info.children.filter((c) => c.canReuseUnchanged).length;
            const rebuildCount = info.children.length - reusableCount;
            this._childHintLabel.text =
                rebuildCount === 0
                    ? `全部 ${reusableCount} 个子模板未改动，默认将直接复用已发布地址`
                    : `${reusableCount} 个可复用，${rebuildCount} 个有改动或未发布将自动先构建`;
            this._childStrategyRow.hidden = false;
        } else {
            this._childStrategyRow.hidden = true;
        }
    }

    private _renderHistory(builds: TinyAppBuildRecord[], total: number) {
        this._historyTitleLabel.text = `历史版本 (${total})`;
        this._historyList.clear();

        if (!builds.length) {
            this._historyList.append(
                new Label({
                    text: '暂无已打包记录',
                    class: `${CLASS_ROOT}-empty`
                })
            );
            return;
        }

        const latestCompleteId = builds.find((b) => b.status === 'complete')?.id;
        for (const item of builds) {
            const card = new Container({
                flex: true,
                flexDirection: 'column',
                class: `${CLASS_ROOT}-version-card`
            });

            const topLine = new Container({
                flex: true,
                flexDirection: 'row',
                class: `${CLASS_ROOT}-version-top`
            });
            const titleGroup = new Container({
                flex: true,
                flexDirection: 'row',
                class: `${CLASS_ROOT}-version-tags`
            });
            titleGroup.append(
                new Label({
                    text: `v${item.version}`,
                    class: `${CLASS_ROOT}-version-num`
                })
            );
            if (item.id === latestCompleteId) {
                titleGroup.append(new Label({ text: '最新', class: [`${CLASS_ROOT}-tag`, 'is-latest'] }));
            }
            if (item.triggeredBy === 'parent-build') {
                titleGroup.append(new Label({ text: '子依赖', class: `${CLASS_ROOT}-tag` }));
            }
            if (item.status === 'error') {
                titleGroup.append(new Label({ text: '失败', class: [`${CLASS_ROOT}-tag`, 'is-error'] }));
            } else if (item.status === 'running') {
                titleGroup.append(new Label({ text: '构建中', class: `${CLASS_ROOT}-tag` }));
            }
            if (item.label) {
                const note = new Label({
                    text: item.label,
                    class: `${CLASS_ROOT}-version-note`
                });
                note.dom.title = item.label;
                titleGroup.append(note);
            }

            const metaRight = new Label({
                text: `${convertDatetime(item.createdAt)}${item.totalBytes ? ` · ${bytesToHuman(item.totalBytes)}` : ''}`,
                class: `${CLASS_ROOT}-version-meta`
            });
            topLine.append(titleGroup);
            topLine.append(metaRight);
            card.append(topLine);

            const bottomLine = new Container({
                flex: true,
                flexDirection: 'row',
                class: `${CLASS_ROOT}-version-bottom`
            });
            const subText = item.status === 'error'
                ? item.error || item.message || '构建失败'
                : item.publicUrl || item.message || '';
            const subLabel = new Label({
                text: subText,
                allowTextSelection: true,
                class:
                    item.status === 'error'
                        ? [`${CLASS_ROOT}-version-url`, 'is-error']
                        : `${CLASS_ROOT}-version-url`
            });
            subLabel.dom.title = subText;
            bottomLine.append(subLabel);

            const btnGroup = new Container({
                flex: true,
                flexDirection: 'row',
                class: `${CLASS_ROOT}-version-btns`
            });
            if (item.publicUrl) {
                const btnCopy = new Button({
                    text: '复制',
                    size: 'small',
                    class: `${CLASS_ROOT}-mini-btn`
                });
                btnCopy.on('click', () => {
                    void copyToClipboard(item.publicUrl!).then(() => flashButtonText(btnCopy, '已复制', '复制'));
                });
                btnGroup.append(btnCopy);

                const btnZip = new Button({
                    text: 'ZIP',
                    size: 'small',
                    class: `${CLASS_ROOT}-mini-btn`
                });
                btnZip.dom.title = '下载该历史版本的压缩包';
                btnZip.on('click', () => {
                    void this._onDownloadBuildZip(item, btnZip);
                });
                btnGroup.append(btnZip);
            }
            if (item.canDelete !== false && item.status !== 'running') {
                const btnDel = new Button({
                    text: '删除',
                    size: 'small',
                    class: [`${CLASS_ROOT}-mini-btn`, 'is-danger']
                });
                btnDel.on('click', () => {
                    void this._onDeleteBuild(item);
                });
                btnGroup.append(btnDel);
            }
            bottomLine.append(btnGroup);
            card.append(bottomLine);

            if (item.referencedBy && item.referencedBy.length > 0) {
                const refNames = item.referencedBy
                    .map((r) => `${r.templateName} v${r.version}`)
                    .join('、');
                card.append(
                    new Label({
                        text: `被父级引用：${refNames}`,
                        class: `${CLASS_ROOT}-ref-hint`
                    })
                );
            }

            this._historyList.append(card);
        }
    }

    private async _onBuildAndPublish() {
        if (!this._asset || this._busy) return;
        const assetId = Number(this._asset.get('id'));
        this._busy = true;
        this._syncButtonStates();
        this._setFeedback('正在提交 TinyApp 构建任务...', 'info');

        try {
            const label = String(this._labelInput.value || '').trim();
            const childStrategy = (this._childStrategySelect.value || 'reuse-if-unchanged') as TinyAppChildStrategy;
            const completed = await editor.api.globals.tinyapps.buildAndWait(assetId, {
                label,
                childStrategy,
                onProgress: (state) => {
                    this._setFeedback(state.message || `状态：${state.stage}`, 'info');
                }
            });
            this._labelInput.value = '';
            const reusedCount = (completed.children || []).filter((c) => c.reused).length;
            const extra = reusedCount > 0 ? `（复用 ${reusedCount} 个子模板）` : '';
            this._setFeedback(`发布完成：v${completed.version}${extra}`, 'success');
            await this._refreshAll();
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._setFeedback(`构建失败：${msg}`, 'error');
            await this._refreshAll();
        } finally {
            this._busy = false;
            this._syncButtonStates();
        }
    }

    private async _onDownloadTemplateZip() {
        if (!this._asset || this._busy) return;
        const assetId = Number(this._asset.get('id'));
        this._busy = true;
        this._syncButtonStates();
        this._setFeedback('正在生成本地排查 ZIP 压缩包...', 'info');
        try {
            const childStrategy = (this._childStrategySelect.value || 'reuse-if-unchanged') as TinyAppChildStrategy;
            const res = await editor.api.globals.tinyapps.downloadTemplateArchive(assetId, {
                childStrategy
            });
            this._setFeedback(`已导出压缩包：${res.filename}`, 'success');
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._setFeedback(`导出 ZIP 失败：${msg}`, 'error');
        } finally {
            this._busy = false;
            this._syncButtonStates();
        }
    }

    private async _onDownloadBuildZip(item: TinyAppBuildRecord, btn: Button) {
        btn.enabled = false;
        try {
            await editor.api.globals.tinyapps.downloadBuildArchive(item.id);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._setFeedback(`下载 v${item.version} ZIP 失败：${msg}`, 'error');
        } finally {
            if (!btn.destroyed) btn.enabled = true;
        }
    }

    private async _onDeleteBuild(item: TinyAppBuildRecord) {
        const hasRefs = Boolean(item.referencedBy && item.referencedBy.length > 0);
        const refNote = hasRefs
            ? `\n\n注意：该版本正被父级 TinyApp（${item.referencedBy!.map((r) => `${r.templateName} v${r.version}`).join('、')}）引用，强制删除后对应父级将无法加载此子模块！`
            : '';
        const confirmed = await editor.api.globals.confirmFn(
            `确认彻底删除 ${item.templateName} v${item.version} 吗？\n这会同步删除 OSS/COS 上的全部已上传资源且不可恢复。${refNote}`,
            { yesText: hasRefs ? '强制删除' : '删除' }
        );
        if (!confirmed) return;

        this._busy = true;
        this._syncButtonStates();
        this._setFeedback(`正在清理 v${item.version} 线上资源...`, 'info');
        try {
            const result = await editor.api.globals.tinyapps.delete(item.id, { force: hasRefs });
            this._setFeedback(
                `已删除 v${item.version}（清理 ${result.deletedObjects} 个文件，释放 ${bytesToHuman(result.freedBytes)}）`,
                'success'
            );
            await this._refreshAll();
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this._setFeedback(`删除失败：${msg}`, 'error');
        } finally {
            this._busy = false;
            this._syncButtonStates();
        }
    }

    link(assets: Observer[]) {
        this.unlink();
        if (!assets || assets.length !== 1 || !editor.api.globals.tinyapps?.isSupported()) {
            return;
        }
        this._asset = assets[0];
        this._setFeedback('');
        this._assetEvents.push(
            this._asset.on('data:set', () => {
                void this._refreshAll();
            }),
            editor.on('permissions:writeState', () => {
                this._syncButtonStates();
            })
        );
        void this._refreshAll();
    }

    unlink() {
        this._loadSeq += 1;
        this._assetEvents.forEach((evt) => evt.unbind());
        this._assetEvents.length = 0;
        this._asset = null;
        this._inspectData = null;
    }
}

export { TemplateAssetInspector };
