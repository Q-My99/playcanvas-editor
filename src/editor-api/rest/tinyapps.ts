import { Ajax } from '../ajax';
import { globals as api } from '../globals';

export type TinyAppChildStrategy = 'reuse-if-unchanged' | 'reuse-latest' | 'force-rebuild';

export type TinyAppBuildStatus = 'running' | 'complete' | 'error' | 'deleting';

export type TinyAppServiceStatus = {
    enabled: boolean;
    publicBaseUrl: string | null;
    archiveEnabled: boolean;
};

export type TinyAppObjectRecord = {
    key: string;
    kind: 'manifest' | 'script' | 'asset' | 'variant' | 'font-page';
    assetId?: number;
    filename: string;
    size: number;
    hash: string;
    url: string;
};

export type TinyAppScriptSummary = {
    assetId: number;
    name: string;
    filename: string;
    size: number;
    hash: string;
};

export type TinyAppChildBuildRef = {
    templateAssetId: number;
    templateName: string;
    buildId: number;
    version: number;
    publicUrl: string;
    reused: boolean;
};

export type TinyAppParentBuildRef = {
    buildId: number;
    projectId: number;
    projectName: string;
    templateAssetId: number;
    templateName: string;
    version: number;
    publicUrl: string | null;
    createdAt: string;
};

export type TinyAppBuildRecord = {
    id: number;
    jobId: number | null;
    projectId: number;
    projectName: string;
    projectDeleted?: boolean;
    projectOwner: { id: number; username: string; organization?: boolean };
    organizationId?: number | null;
    branchId: string;
    branchName: string;
    templateAssetId: number;
    templateName: string;
    version: number;
    label: string;
    triggeredBy: 'manual' | 'parent-build';
    status: TinyAppBuildStatus;
    stage: string;
    message: string;
    progress: {
        completedFiles: number;
        totalFiles: number;
        uploadedBytes: number;
        totalBytes: number;
    };
    contentHash: string;
    publicUrl: string | null;
    scriptUrl: string | null;
    totalFiles: number;
    totalBytes: number;
    storage: {
        bucket: string;
        prefix: string;
        buildSlug: string;
        publicBaseUrl: string;
    } | null;
    objects?: TinyAppObjectRecord[];
    scripts: TinyAppScriptSummary[];
    skippedBuiltinScripts: string[];
    children: TinyAppChildBuildRef[];
    referencedBy?: TinyAppParentBuildRef[];
    warnings: string[];
    error: string | null;
    actor: { id: number; username: string; name?: string };
    canDelete?: boolean;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    durationMs: number | null;
};

export type TinyAppInspectResult = {
    service: TinyAppServiceStatus;
    projectId: number;
    branchId: string;
    branchName: string;
    templateAssetId: number;
    templateName: string;
    entityCount: number;
    contentHash: string;
    hasUnbuiltChanges: boolean;
    latestBuild: TinyAppBuildRecord | null;
    assets: {
        id: number;
        name: string;
        type: string;
        filename: string | null;
        size: number;
        variantCount: number;
        fontPageCount: number;
    }[];
    scripts: TinyAppScriptSummary[];
    skippedBuiltinScripts: string[];
    children: {
        templateAssetId: number;
        templateName: string;
        contentHash: string;
        latestBuild: {
            id: number;
            version: number;
            publicUrl: string;
            createdAt: string;
            contentHash: string;
        } | null;
        canReuseUnchanged: boolean;
    }[];
    estimatedFiles: number;
    estimatedBytes: number;
    warnings: string[];
};

export type TinyAppBuildListResponse = {
    service: TinyAppServiceStatus;
    result: TinyAppBuildRecord[];
    pagination: { skip: number; limit: number; total: number };
};

export type TinyAppProjectSummaryResponse = {
    service: TinyAppServiceStatus;
    templates: {
        projectId: number;
        projectName: string;
        projectDeleted: boolean;
        templateAssetId: number;
        templateName: string;
        templateExists: boolean;
        buildCount: number;
        totalBytes: number;
        canDelete: boolean;
        latestBuild: TinyAppBuildRecord | null;
    }[];
    builds: TinyAppBuildRecord[];
    pagination: { skip: number; limit: number; total: number };
    totals: {
        buildCount: number;
        templateCount: number;
        totalBytes: number;
        orphanedBuildCount: number;
    };
};

export type TinyAppDeleteResult = {
    deleted: TinyAppBuildRecord;
    deletedObjects: number;
    freedBytes: number;
};

const buildQuery = (params: Record<string, string | number | boolean | undefined>) => {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
    if (!entries.length) return '';
    const search = entries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
    return `?${search}`;
};

export const tinyappStatus = (projectId: number = api.projectId) => {
    return Ajax.get<TinyAppServiceStatus>({
        url: `${api.apiUrl}/projects/${projectId}/tinyapps/status`,
        auth: true
    });
};

export const tinyappInspect = (args: {
    projectId?: number;
    assetId: number;
    branchId?: string;
}) => {
    const projectId = args.projectId ?? api.projectId;
    const query = buildQuery({ branchId: args.branchId ?? api.branchId });
    return Ajax.get<TinyAppInspectResult>({
        url: `${api.apiUrl}/projects/${projectId}/templates/${args.assetId}/tinyapp/inspect${query}`,
        auth: true
    });
};

export const tinyappProjectList = (args: {
    projectId?: number;
    q?: string;
    status?: string;
    skip?: number;
    limit?: number;
} = {}) => {
    const projectId = args.projectId ?? api.projectId;
    const query = buildQuery({
        q: args.q,
        status: args.status,
        skip: args.skip,
        limit: args.limit
    });
    return Ajax.get<TinyAppProjectSummaryResponse>({
        url: `${api.apiUrl}/projects/${projectId}/tinyapps${query}`,
        auth: true
    });
};

export const tinyappBuildList = (args: {
    projectId?: number;
    assetId: number;
    branchId?: string;
    status?: string;
    skip?: number;
    limit?: number;
}) => {
    const projectId = args.projectId ?? api.projectId;
    const query = buildQuery({
        branchId: args.branchId,
        status: args.status,
        skip: args.skip,
        limit: args.limit
    });
    return Ajax.get<TinyAppBuildListResponse>({
        url: `${api.apiUrl}/projects/${projectId}/templates/${args.assetId}/tinyapp/builds${query}`,
        auth: true
    });
};

export const tinyappBuildGet = (args: {
    projectId?: number;
    buildId: number;
    summary?: boolean;
}) => {
    const projectId = args.projectId ?? api.projectId;
    const query = buildQuery({ summary: args.summary ? '1' : undefined });
    return Ajax.get<TinyAppBuildRecord>({
        url: `${api.apiUrl}/projects/${projectId}/tinyapps/builds/${args.buildId}${query}`,
        auth: true
    });
};

export const tinyappBuildStart = (args: {
    projectId?: number;
    assetId: number;
    branchId?: string;
    sceneId?: string | number | null;
    label?: string;
    suffix?: string;
    childStrategy?: TinyAppChildStrategy;
}) => {
    const projectId = args.projectId ?? api.projectId;
    return Ajax.post<TinyAppBuildRecord>({
        url: `${api.apiUrl}/projects/${projectId}/templates/${args.assetId}/tinyapp/builds`,
        auth: true,
        data: {
            branchId: args.branchId ?? api.branchId,
            sceneId: args.sceneId,
            label: args.label,
            suffix: args.suffix,
            childStrategy: args.childStrategy
        }
    });
};

export const tinyappBuildDelete = (args: {
    projectId?: number;
    buildId: number;
    force?: boolean;
}) => {
    const projectId = args.projectId ?? api.projectId;
    const query = buildQuery({ force: args.force ? true : undefined });
    return Ajax.delete<TinyAppDeleteResult>({
        url: `${api.apiUrl}/projects/${projectId}/tinyapps/builds/${args.buildId}${query}`,
        auth: true
    });
};
