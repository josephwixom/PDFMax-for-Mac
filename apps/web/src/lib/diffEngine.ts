/**
 * Diff Engine — compares two sets of OcrPage arrays and produces
 * per-page change reports that the UI can render as highlighted overlays.
 */
import { diff_match_patch, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } from 'diff-match-patch';
import type { OcrPage, OcrWord } from './ocrService';

export type ChangeType = 'added' | 'removed' | 'changed' | 'equal';

export interface TextDiff {
    text: string;
    type: ChangeType;
}

export interface PageChange {
    pageNum: number;        // 1-indexed (based on the document being compared)
    diffs: TextDiff[];
    addedCount: number;
    removedCount: number;
    changedWords: WordChange[];
    similarity: number;     // 0–1, where 1 = identical
}

export interface WordChange {
    word: OcrWord;
    type: 'added' | 'removed';
    docIndex: 0 | 1;       // 0 = document A, 1 = document B
}

export interface CompareResult {
    pageChanges: PageChange[];
    totalAdded: number;
    totalRemoved: number;
    unchangedPages: number;
    changedPages: number;
    summary: string;
}

const dmp = new diff_match_patch();

/**
 * Compare two complete OCR extractions (page arrays from two PDF versions).
 * Pages are aligned by index; extra pages on the longer doc are marked as wholly added/removed.
 */
export function comparePdfExtracts(
    docA: OcrPage[],
    docB: OcrPage[]
): CompareResult {
    const maxPages = Math.max(docA.length, docB.length);
    const pageChanges: PageChange[] = [];
    let totalAdded = 0;
    let totalRemoved = 0;
    let unchangedPages = 0;
    let changedPages = 0;

    for (let i = 0; i < maxPages; i++) {
        const pageA = docA[i];
        const pageB = docB[i];

        const textA = pageA?.text ?? '';
        const textB = pageB?.text ?? '';
        const wordsA = pageA?.words ?? [];
        const wordsB = pageB?.words ?? [];

        // ── Word-level diff ─────────────────────────────────────────────
        const rawDiffs = dmp.diff_main(textA, textB);
        dmp.diff_cleanupSemantic(rawDiffs);

        const diffs: TextDiff[] = rawDiffs.map(([op, text]: [number, string]) => ({
            text,
            type: op === DIFF_INSERT ? 'added' : op === DIFF_DELETE ? 'removed' : 'equal',
        }));

        const added = diffs.filter(d => d.type === 'added').reduce((s, d) => s + d.text.length, 0);
        const removed = diffs.filter(d => d.type === 'removed').reduce((s, d) => s + d.text.length, 0);

        // ── Similarity score ─────────────────────────────────────────────
        const longest = Math.max(textA.length, textB.length, 1);
        const levenshtein = dmp.diff_levenshtein(rawDiffs);
        const similarity = Math.max(0, 1 - levenshtein / longest);

        // ── Word-level bounding box changes (approximate) ────────────────
        const changedWords: WordChange[] = [];
        if (!pageA) {
            // Entire page added
            wordsB.forEach(w => changedWords.push({ word: w, type: 'added', docIndex: 1 }));
        } else if (!pageB) {
            // Entire page removed
            wordsA.forEach(w => changedWords.push({ word: w, type: 'removed', docIndex: 0 }));
        } else {
            // Find words in A that are absent from B and vice versa
            const setA = new Set(wordsA.map(w => w.text.toLowerCase().trim()));
            const setB = new Set(wordsB.map(w => w.text.toLowerCase().trim()));
            wordsB
                .filter(w => !setA.has(w.text.toLowerCase().trim()))
                .forEach(w => changedWords.push({ word: w, type: 'added', docIndex: 1 }));
            wordsA
                .filter(w => !setB.has(w.text.toLowerCase().trim()))
                .forEach(w => changedWords.push({ word: w, type: 'removed', docIndex: 0 }));
        }

        const isChanged = similarity < 0.99;
        if (isChanged) changedPages++; else unchangedPages++;
        totalAdded += added;
        totalRemoved += removed;

        pageChanges.push({
            pageNum: i + 1,
            diffs,
            addedCount: added,
            removedCount: removed,
            changedWords,
            similarity,
        });
    }

    const summary = changedPages === 0
        ? 'No differences found — documents are identical.'
        : `${changedPages} page${changedPages > 1 ? 's' : ''} changed, ${unchangedPages} unchanged. ${totalAdded} characters added, ${totalRemoved} removed.`;

    return { pageChanges, totalAdded, totalRemoved, unchangedPages, changedPages, summary };
}

/**
 * Quick single-page comparison — useful for live diff as each page is extracted.
 */
export function comparePageText(textA: string, textB: string): TextDiff[] {
    const rawDiffs = dmp.diff_main(textA, textB);
    dmp.diff_cleanupSemantic(rawDiffs);
    return rawDiffs.map(([op, text]: [number, string]) => ({
        text,
        type: op === DIFF_INSERT ? 'added' : op === DIFF_DELETE ? 'removed' : 'equal' as ChangeType,
    }));
}
