import { MergeFileEditor } from './merge-file-editor';

editor.once('load', () => {
    if (!editor.call('editor:resolveConflictMode')) {
        return;
    }
    if (config.self.branch.merge.isDiff) {
        return;
    }

    const mergeFileEditor = new MergeFileEditor();
    mergeFileEditor.run();

    /**
     * Gets the number of conflict overlays in the code editor
     */
    editor.method('editor:merge:getNumberOfConflicts', () => {
        // Do not let the overlay debounce hide a just-typed conflict marker on save.
        if (mergeFileEditor.model) mergeFileEditor.refreshOverlays();
        return mergeFileEditor.overlayGroups.length;
    });

    /**
     * Returns true if the code editor is dirty
     */
    editor.method('editor:merge:isDirty', () => {
        return mergeFileEditor.isDirty;
    });

    /**
     * Gets the current content of the code editor
     */
    editor.method('editor:merge:getContent', () => {
        return mergeFileEditor.monacoEditor.getValue();
    });

    /**
     * Sets the current content of the code editor
     */
    editor.method('editor:merge:setContent', (value: string) => {
        if (!mergeFileEditor.model) return;
        return mergeFileEditor.monacoEditor.setValue(value);
    });

    editor.method('editor:merge:onContentChange', (callback: () => void) => {
        return mergeFileEditor.monacoEditor.onDidChangeModelContent(callback);
    });

    editor.method('editor:merge:isReady', () => !!(mergeFileEditor.model && mergeFileEditor.etag));
    editor.method('editor:merge:getError', () => mergeFileEditor.loadError);
    editor.method('editor:merge:getRevision', () => mergeFileEditor.etag);
    editor.method('editor:merge:markSaved', (etag: string | null, contents: string) => {
        mergeFileEditor.etag = etag;
        mergeFileEditor.isDirty = mergeFileEditor.monacoEditor.getValue() !== contents;
    });
    editor.method('editor:merge:onStateChange', (callback: () => void) => {
        const event = editor.on('editor:merge:stateChange', callback);
        return { dispose: () => event.unbind() };
    });

    /**
     * Moves cursor to the next conflict
     */
    editor.method('editor:merge:goToNextConflict', () => {
        mergeFileEditor.goToNextConflict();
    });

    /**
     * Moves cursor to the previous conflict
     */
    editor.method('editor:merge:goToPrevConflict', () => {
        mergeFileEditor.goToPrevConflict();
    });
});
