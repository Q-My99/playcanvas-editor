/**
 * Structural string differences are not editable file artifacts. Only a
 * persisted merge conflict with an opaque file token can open the resolver.
 * The server reauthorizes all of these identifiers before returning any bytes.
 */
export const isEditableTextConflict = (
    merge: { id?: unknown; isDiff?: unknown } | null | undefined,
    entry: { id?: unknown; isTextualMerge?: unknown; mergedFilePath?: unknown }
): boolean => !!merge && typeof merge.id === 'string' && !!merge.id && !merge.isDiff &&
    entry.isTextualMerge === true && typeof entry.id === 'string' && !!entry.id &&
    typeof entry.mergedFilePath === 'string' && !!entry.mergedFilePath;
