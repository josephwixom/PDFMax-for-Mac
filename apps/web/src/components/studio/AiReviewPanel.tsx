'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
    reviewShopDrawing, renderPageForAiReview,
    loadAiConfig, saveAiConfig,
    type AiProviderConfig, type ReviewResult, type ReviewItemResult,
} from '@/lib/aiReviewService';
import { AWI_CHECKLIST, type AwiCheckItem } from '@/lib/awiChecklist';

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusValue = 'PASS' | 'FAIL' | 'WARN' | 'N/A';
type ItemSource = 'ai' | 'manual' | 'none';

interface ItemState {
    status: StatusValue;
    note: string;
    source: ItemSource;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<StatusValue, { label: string; color: string; dot: string; btn: string }> = {
    PASS: { label: 'Pass', color: 'text-green-700 bg-green-100', dot: 'bg-green-500', btn: 'bg-green-600 text-white border-green-600' },
    FAIL: { label: 'Fail', color: 'text-red-700 bg-red-100', dot: 'bg-red-500', btn: 'bg-red-600 text-white border-red-600' },
    WARN: { label: 'Warn', color: 'text-amber-700 bg-amber-100', dot: 'bg-amber-500', btn: 'bg-amber-500 text-white border-amber-500' },
    'N/A': { label: 'N/A', color: 'text-gray-400 bg-gray-100', dot: 'bg-gray-300', btn: 'bg-gray-400 text-white border-gray-400' },
};

const GRADE_META = {
    PASS: 'bg-green-100 text-green-800 border-green-300',
    WARN: 'bg-amber-100 text-amber-800 border-amber-300',
    FAIL: 'bg-red-100 text-red-800 border-red-300',
} as const;

const CATEGORIES = ['drawing', 'dimensions', 'joinery', 'material', 'hardware', 'finish'] as const;
const CAT_LABELS: Record<typeof CATEGORIES[number], string> = {
    drawing: '📐 Drawing', dimensions: '📏 Dimensions', joinery: '🔧 Joinery',
    material: '🪵 Material', hardware: '⚙️ Hardware', finish: '🎨 Finish',
};

const STATUSES: StatusValue[] = ['PASS', 'WARN', 'FAIL', 'N/A'];

const OPENAI_MODELS = [
    { value: 'gpt-4o', label: 'GPT-4o  (vision · recommended)' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini  (faster · cheaper)' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo  (vision)' },
];
const CLAUDE_MODELS = [
    { value: 'claude-opus-4-5', label: 'Claude Opus 4.5  (best quality)' },
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5  (fast · recommended)' },
    { value: 'claude-haiku-3-5', label: 'Claude Haiku 3.5  (fastest · cheapest)' },
];
const OLLAMA_MODELS = [
    { value: 'qwen3.5', label: 'Qwen3.5  (vision · cutting edge · default)' },
    { value: 'qwen3.5:27b', label: 'Qwen3.5 27B  (vision · balanced)' },
    { value: 'qwen3.5:35b', label: 'Qwen3.5 35B  (vision · high quality)' },
    { value: 'qwen3.5:122b', label: 'Qwen3.5 122B  (vision · best quality)' },
    { value: 'qwen2.5vl', label: 'Qwen2.5-VL  (vision · previous gen)' },
    { value: 'qwen2.5vl:7b', label: 'Qwen2.5-VL 7B  (vision · lightweight)' },
    { value: 'qwen3', label: 'Qwen3  (text only)' },
    { value: 'llava', label: 'LLaVA  (vision · general)' },
    { value: 'llava-phi3', label: 'LLaVA-Phi3  (smaller · fast)' },
    { value: 'llava:13b', label: 'LLaVA 13B  (better quality)' },
    { value: 'bakllava', label: 'BakLLaVA  (vision)' },
    { value: 'minicpm-v', label: 'MiniCPM-V  (compact vision)' },
    { value: '__custom__', label: 'Custom model…' },
];

/** Build initial empty state for all checklist items */
function emptyItemStates(): Record<string, ItemState> {
    const out: Record<string, ItemState> = {};
    for (const item of AWI_CHECKLIST) out[item.id] = { status: 'N/A', note: '', source: 'none' };
    return out;
}

/** Calculate live score + grade from item states */
function calcScore(states: Record<string, ItemState>): { score: number; grade: 'PASS' | 'WARN' | 'FAIL'; pass: number; warn: number; fail: number } {
    const all = Object.values(states);
    const relevant = all.filter(s => s.status !== 'N/A');
    const pass = relevant.filter(s => s.status === 'PASS').length;
    const warn = relevant.filter(s => s.status === 'WARN').length;
    const fail = relevant.filter(s => s.status === 'FAIL').length;
    const score = relevant.length > 0 ? Math.round((pass / relevant.length) * 100) : 0;
    const grade: 'PASS' | 'WARN' | 'FAIL' = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : relevant.length > 0 ? 'PASS' : 'WARN';
    return { score, grade, pass, warn, fail };
}

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

// ─── Settings panel ───────────────────────────────────────────────────────────
function SettingsPanel({ cfg, onSave }: { cfg: AiProviderConfig; onSave: (c: AiProviderConfig) => void }) {
    const [local, setLocal] = useState<AiProviderConfig>(cfg);
    const [testState, setTestState] = useState<TestState>('idle');
    const [testMsg, setTestMsg] = useState('');
    const [customModel, setCustomModel] = useState('');
    const isCustom = local.provider === 'ollama' && local.model === '__custom__';
    const effectiveModel = isCustom ? customModel : (local.model ?? '');

    const handleProviderChange = (provider: 'openai' | 'ollama' | 'claude') => {
        setLocal(p => ({
            ...p, provider,
            model: provider === 'openai' ? 'gpt-4o' : provider === 'claude' ? 'claude-sonnet-4-5' : 'qwen3.5:27b',
            baseUrl: provider === 'openai' ? 'https://api.openai.com'
                : provider === 'claude' ? 'https://api.anthropic.com'
                    : (p.baseUrl ?? 'http://localhost:11434'),
        }));
        setTestState('idle');
    };

    const handleTest = async () => {
        setTestState('testing'); setTestMsg('');
        try {
            if (local.provider === 'claude') {
                const resp = await fetch('https://api.anthropic.com/v1/models', {
                    headers: { 'x-api-key': local.apiKey ?? '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
                });
                if (resp.ok) { setTestMsg('✓ Claude API key valid'); setTestState('ok'); }
                else { const e = await resp.json().catch(() => ({})); throw new Error((e as any)?.error?.message ?? `HTTP ${resp.status}`); }
            } else if (local.provider === 'openai') {
                const resp = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${local.apiKey ?? ''}` } });
                if (resp.ok) { setTestMsg('✓ OpenAI key valid'); setTestState('ok'); }
                else { const e = await resp.json().catch(() => ({})); throw new Error((e as any)?.error?.message ?? `HTTP ${resp.status}`); }
            } else {
                const base = local.baseUrl ?? 'http://localhost:11434';
                const resp = await fetch(`${base}/api/tags`);
                if (resp.ok) { const d = await resp.json(); setTestMsg(`✓ Ollama — ${(d.models as any[]).map(m => m.name).join(', ') || 'no models'}`); setTestState('ok'); }
                else throw new Error(`Ollama not reachable at ${base}`);
            }
        } catch (err: any) { setTestMsg(String(err?.message ?? err)); setTestState('fail'); }
    };

    return (
        <div className="p-2 space-y-2 text-xs">
            <div>
                <label className="block text-gray-500 mb-0.5 font-medium">Provider</label>
                <div className="grid grid-cols-3 gap-1.5">
                    {([
                        { id: 'claude', label: '🤖 Claude', active: 'bg-orange-600 text-white border-orange-600' },
                        { id: 'openai', label: '☁️ OpenAI', active: 'bg-emerald-600 text-white border-emerald-600' },
                        { id: 'ollama', label: '🖥 Ollama', active: 'bg-violet-600 text-white border-violet-600' },
                    ] as const).map(p => (
                        <button key={p.id} onClick={() => handleProviderChange(p.id)}
                            className={`py-1.5 rounded text-[11px] font-semibold border transition-colors ${local.provider === p.id ? p.active : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'}`}>
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>
            {(local.provider === 'claude' || local.provider === 'openai') && (
                <div>
                    <label className="block text-gray-500 mb-0.5 font-medium">{local.provider === 'claude' ? 'Anthropic API Key' : 'OpenAI API Key'}</label>
                    <input type="password" value={local.apiKey ?? ''} onChange={e => setLocal(p => ({ ...p, apiKey: e.target.value }))}
                        placeholder={local.provider === 'claude' ? 'sk-ant-…' : 'sk-…'}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                    {local.provider === 'claude' && (
                        <p className="text-[10px] text-gray-400 mt-0.5">Get key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-indigo-500 underline">console.anthropic.com</a></p>
                    )}
                </div>
            )}
            <div>
                <label className="block text-gray-500 mb-0.5 font-medium">Model</label>
                <select value={local.model ?? ''} onChange={e => setLocal(p => ({ ...p, model: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400">
                    {(local.provider === 'openai' ? OPENAI_MODELS : local.provider === 'claude' ? CLAUDE_MODELS : OLLAMA_MODELS).map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                </select>
                {isCustom && (
                    <input value={customModel} onChange={e => setCustomModel(e.target.value)} placeholder="e.g. my-finetuned-llava"
                        className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                )}
            </div>
            {local.provider === 'ollama' && (
                <div>
                    <label className="block text-gray-500 mb-0.5 font-medium">Ollama Server URL</label>
                    <input value={local.baseUrl ?? 'http://localhost:11434'} onChange={e => setLocal(p => ({ ...p, baseUrl: e.target.value }))}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                </div>
            )}
            <button onClick={handleTest} disabled={testState === 'testing'}
                className="w-full py-1.5 border border-indigo-300 text-indigo-600 rounded text-xs font-semibold hover:bg-indigo-50 disabled:opacity-40 transition-colors">
                {testState === 'testing' ? 'Testing…' : '⚡ Test Connection'}
            </button>
            {testMsg && (
                <p className={`text-[10px] rounded px-2 py-1 leading-snug ${testState === 'ok' ? 'text-green-700 bg-green-50' : 'text-red-600 bg-red-50'}`}>{testMsg}</p>
            )}
            <button onClick={() => onSave({ ...local, model: effectiveModel || (local.provider === 'openai' ? 'gpt-4o' : 'llava') })}
                className="w-full py-1.5 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700 transition-colors">
                Attach Model
            </button>
        </div>
    );
}

// ─── Score ring ───────────────────────────────────────────────────────────────
function ScoreRing({ score, grade }: { score: number; grade: 'PASS' | 'WARN' | 'FAIL' }) {
    const r = 24, circ = 2 * Math.PI * r;
    const color = grade === 'PASS' ? '#16a34a' : grade === 'WARN' ? '#d97706' : '#dc2626';
    return (
        <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
            <circle cx="32" cy="32" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
            <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6"
                strokeDasharray={`${(score / 100) * circ} ${circ}`} strokeLinecap="round"
                transform="rotate(-90 32 32)" />
            <text x="32" y="36" fontSize="12" fontWeight="bold" fill={color} textAnchor="middle">{score}%</text>
        </svg>
    );
}

// ─── Manual checklist category section ───────────────────────────────────────
function ManualCategory({
    cat, items, states, onUpdate,
}: {
    cat: typeof CATEGORIES[number];
    items: AwiCheckItem[];
    states: Record<string, ItemState>;
    onUpdate: (id: string, patch: Partial<ItemState>) => void;
}) {
    const [open, setOpen] = useState(true);
    const catItems = items.filter(i => i.category === cat);
    const catStates = catItems.map(i => states[i.id]);
    const relevant = catStates.filter(s => s.status !== 'N/A');
    const pass = relevant.filter(s => s.status === 'PASS').length;
    const fail = relevant.filter(s => s.status === 'FAIL').length;
    const warn = relevant.filter(s => s.status === 'WARN').length;
    const score = relevant.length > 0 ? Math.round((pass / relevant.length) * 100) : null;

    return (
        <div className="border border-gray-200 rounded overflow-hidden">
            <button className="w-full flex items-center justify-between px-2 py-1.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left" onClick={() => setOpen(o => !o)}>
                <span className="text-xs font-semibold text-gray-700">{CAT_LABELS[cat]}</span>
                <div className="flex items-center gap-1.5">
                    {fail > 0 && <span className="text-[10px] px-1 rounded bg-red-100 text-red-700">{fail} fail</span>}
                    {warn > 0 && <span className="text-[10px] px-1 rounded bg-amber-100 text-amber-700">{warn} warn</span>}
                    {score !== null && <span className="text-[10px] font-bold text-gray-500">{score}%</span>}
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                </div>
            </button>
            {open && (
                <div className="divide-y divide-gray-100">
                    {catItems.map(ci => {
                        const st = states[ci.id];
                        return (
                            <div key={ci.id} className="px-2 py-2 space-y-1.5">
                                {/* Item header */}
                                <div className="flex items-start gap-1.5">
                                    <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${STATUS_META[st.status].dot}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            <span className="text-[10px] text-gray-400 font-mono">{ci.id}</span>
                                            {st.source === 'ai' && (
                                                <span className="text-[9px] px-1 rounded bg-violet-100 text-violet-600 font-semibold">🤖 AI</span>
                                            )}
                                            {st.source === 'manual' && (
                                                <span className="text-[9px] px-1 rounded bg-blue-100 text-blue-600 font-semibold">✏️ Manual</span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-gray-700 leading-tight">{ci.description}</p>
                                        <p className="text-[10px] text-gray-400 leading-tight">{ci.premium}</p>
                                    </div>
                                </div>
                                {/* Status toggles */}
                                <div className="flex gap-1">
                                    {STATUSES.map(s => (
                                        <button key={s}
                                            onClick={() => onUpdate(ci.id, {
                                                status: s,
                                                source: 'manual',
                                            })}
                                            className={`flex-1 py-0.5 text-[10px] font-semibold rounded border transition-colors
                                                ${st.status === s
                                                    ? STATUS_META[s].btn
                                                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                                            {STATUS_META[s].label}
                                        </button>
                                    ))}
                                </div>
                                {/* Note input */}
                                <input
                                    type="text"
                                    value={st.note}
                                    onChange={e => onUpdate(ci.id, { note: e.target.value })}
                                    placeholder="Add a note… (optional)"
                                    className="w-full text-[10px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-600 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                                />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── AI results category card (read-only, collapsible) ────────────────────────
function AiCategory({ cat, items, results }: {
    cat: typeof CATEGORIES[number];
    items: AwiCheckItem[];
    results: ReviewItemResult[];
}) {
    const [open, setOpen] = useState(false);
    const catItems = items.filter(i => i.category === cat);
    const catResults = results.filter(r => catItems.some(i => i.id === r.id));
    const pass = catResults.filter(r => r.status === 'PASS').length;
    const fail = catResults.filter(r => r.status === 'FAIL').length;
    const warn = catResults.filter(r => r.status === 'WARN').length;
    const relevant = catResults.filter(r => r.status !== 'N/A').length;
    const score = relevant > 0 ? Math.round((pass / relevant) * 100) : null;

    return (
        <div className="border border-gray-200 rounded overflow-hidden">
            <button className="w-full flex items-center justify-between px-2 py-1.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left" onClick={() => setOpen(o => !o)}>
                <span className="text-xs font-semibold text-gray-700">{CAT_LABELS[cat]}</span>
                <div className="flex items-center gap-1.5">
                    {fail > 0 && <span className="text-[10px] px-1 rounded bg-red-100 text-red-700">{fail} fail</span>}
                    {warn > 0 && <span className="text-[10px] px-1 rounded bg-amber-100 text-amber-700">{warn} warn</span>}
                    {score !== null && <span className="text-[10px] font-bold text-gray-500">{score}%</span>}
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                </div>
            </button>
            {open && (
                <div className="divide-y divide-gray-100">
                    {catItems.map(ci => {
                        const r = catResults.find(r => r.id === ci.id);
                        const meta = STATUS_META[r?.status ?? 'N/A'];
                        return (
                            <div key={ci.id} className="px-2 py-1.5">
                                <div className="flex items-start gap-1.5">
                                    <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="text-[10px] text-gray-400 font-mono">{ci.id}</span>
                                            <span className={`text-[10px] px-1 rounded font-semibold ${meta.color}`}>{meta.label}</span>
                                        </div>
                                        <p className="text-[11px] text-gray-700 leading-tight mt-0.5">{ci.description}</p>
                                        {r?.note && <p className="text-[10px] text-indigo-700 bg-indigo-50 rounded px-1 py-0.5 mt-0.5 leading-tight">{r.note}</p>}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function AiReviewPanel() {
    const [activeTab, setActiveTab] = useState<'ai' | 'manual'>('ai');

    // ── AI Review state ──────────────────────────────────────────────────────
    const [file, setFile] = useState<File | null>(null);
    const [totalPages, setTotalPages] = useState(1);
    const [pageNum, setPageNum] = useState(1);
    const [status, setStatus] = useState<'idle' | 'rendering' | 'reviewing' | 'done' | 'error'>('idle');
    const [aiResult, setAiResult] = useState<ReviewResult | null>(null);
    const [error, setError] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [cfg, setCfg] = useState<AiProviderConfig>(loadAiConfig);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pdfDataRef = useRef<ArrayBuffer | null>(null);

    // ── Manual checklist state ───────────────────────────────────────────────
    const [itemStates, setItemStates] = useState<Record<string, ItemState>>(emptyItemStates);

    // ── Derived scores ───────────────────────────────────────────────────────
    // AI tab score comes from aiResult
    const aiPass = aiResult?.items.filter(i => i.status === 'PASS').length ?? 0;
    const aiWarn = aiResult?.items.filter(i => i.status === 'WARN').length ?? 0;
    const aiFail = aiResult?.items.filter(i => i.status === 'FAIL').length ?? 0;

    // Manual tab score computed live from itemStates
    const manualCalc = calcScore(itemStates);

    // ── File picker ──────────────────────────────────────────────────────────
    const handleFile = useCallback(async (f: File) => {
        setFile(f); setAiResult(null); setError('');
        const buf = await f.arrayBuffer();
        pdfDataRef.current = buf;
        const pdfjsLib = await import('pdfjs-dist');
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        setTotalPages(doc.numPages);
        setPageNum(1);
    }, []);

    // ── AI review → seed manual checklist ───────────────────────────────────
    const handleReview = useCallback(async () => {
        if (!pdfDataRef.current) return;
        setStatus('rendering'); setError('');
        try {
            const canvas = await renderPageForAiReview(pdfDataRef.current, pageNum);
            setPreviewUrl(canvas.toDataURL('image/png'));
            setStatus('reviewing');
            const res = await reviewShopDrawing(canvas, cfg);
            setAiResult(res);
            setStatus('done');
            // Seed manual checklist from AI results — only override N/A items
            setItemStates(prev => {
                const next = { ...prev };
                for (const item of res.items) {
                    next[item.id] = {
                        status: item.status as StatusValue,
                        note: item.note ?? '',
                        source: 'ai',
                    };
                }
                return next;
            });
        } catch (err: any) {
            setError(String(err?.message ?? err));
            setStatus('error');
        }
    }, [cfg, pageNum]);

    const handleSaveConfig = (c: AiProviderConfig) => {
        setCfg(c); saveAiConfig(c); setShowSettings(false);
    };

    const handleItemUpdate = useCallback((id: string, patch: Partial<ItemState>) => {
        setItemStates(prev => ({
            ...prev,
            [id]: { ...prev[id], ...patch },
        }));
    }, []);

    // ── Export report ────────────────────────────────────────────────────────
    const handleExportReport = useCallback(() => {
        const { score, grade } = calcScore(itemStates);
        const report = {
            title: 'AWI Premium Grade Compliance Review',
            generatedAt: new Date().toISOString(),
            file: file?.name ?? 'unknown',
            page: pageNum,
            aiModel: aiResult ? `${aiResult.provider} / ${aiResult.model}` : null,
            aiSummary: aiResult?.summary ?? null,
            overallScore: score,
            grade,
            items: AWI_CHECKLIST.map(ci => {
                const st = itemStates[ci.id];
                return {
                    id: ci.id,
                    section: ci.section,
                    category: ci.category,
                    description: ci.description,
                    premium: ci.premium,
                    status: st.status,
                    note: st.note || null,
                    source: st.source,
                };
            }),
            criticalIssues: aiResult?.criticalIssues ?? [],
            recommendations: aiResult?.recommendations ?? [],
        };
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `awi-review-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }, [itemStates, file, pageNum, aiResult]);

    const hasAnyData = Object.values(itemStates).some(s => s.source !== 'none');

    return (
        <div className="flex flex-col h-full text-sm overflow-hidden">

            {/* ── Tab bar ── */}
            <div className="shrink-0 flex border-b border-gray-200 bg-gray-50">
                {([
                    { id: 'ai', label: '🤖 AI Review' },
                    { id: 'manual', label: '✅ Checklist' },
                ] as const).map(t => (
                    <button key={t.id} onClick={() => setActiveTab(t.id)}
                        className={`flex-1 py-2 text-[11px] font-semibold border-b-2 transition-colors
                            ${activeTab === t.id
                                ? 'border-violet-600 text-violet-700 bg-white'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ── Live score banner (always visible once any data exists) ── */}
            {hasAnyData && (
                <div className={`shrink-0 flex items-center gap-3 mx-2 mt-2 p-2 rounded-lg border ${GRADE_META[manualCalc.grade]}`}>
                    <ScoreRing score={manualCalc.score} grade={manualCalc.grade} />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-xs font-bold">AWI Premium Grade</span>
                            <span className={`text-[10px] px-1 rounded font-bold border ${GRADE_META[manualCalc.grade]}`}>{manualCalc.grade}</span>
                        </div>
                        <div className="flex gap-2 text-[10px]">
                            <span className="text-green-700">✓ {manualCalc.pass} pass</span>
                            <span className="text-amber-700">⚠ {manualCalc.warn} warn</span>
                            <span className="text-red-700">✗ {manualCalc.fail} fail</span>
                        </div>
                        {aiResult && activeTab === 'manual' && (
                            <p className="text-[9px] text-gray-400 mt-0.5">Seeded from AI · Override any item below</p>
                        )}
                    </div>
                    <button onClick={handleExportReport} title="Export compliance report as JSON"
                        className="shrink-0 px-2 py-1 text-[10px] font-semibold bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors text-gray-600">
                        ⬇ Report
                    </button>
                </div>
            )}

            {/* ════════════════════ AI REVIEW TAB ════════════════════ */}
            {activeTab === 'ai' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Header controls */}
                    <div className="shrink-0 px-3 pt-3 pb-2 border-b border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-semibold text-gray-800 text-xs uppercase tracking-wide">AI Shop Drawing Review</h3>
                            <button onClick={() => setShowSettings(s => !s)}
                                className={`p-1 rounded hover:bg-gray-100 transition-colors ${showSettings ? 'text-indigo-600' : 'text-gray-400'}`} title="AI Settings">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                </svg>
                            </button>
                        </div>

                        {showSettings && (
                            <div className="mb-2 bg-gray-50 border border-gray-200 rounded">
                                <SettingsPanel cfg={cfg} onSave={handleSaveConfig} />
                            </div>
                        )}

                        {!showSettings && (
                            <div className="flex items-center gap-1 mb-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${cfg.provider === 'claude' ? 'bg-orange-100 text-orange-700' : cfg.provider === 'openai' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'}`}>
                                    {cfg.provider === 'claude' ? '🤖 Claude' : cfg.provider === 'openai' ? '☁️ OpenAI' : '🖥 Ollama Local'}
                                </span>
                                <span className="text-[10px] text-gray-400 font-mono">{cfg.model ?? 'claude-sonnet-4-5'}</span>
                            </div>
                        )}

                        {/* File picker */}
                        <div
                            className={`relative flex items-center gap-2 p-2 rounded-lg border-2 border-dashed cursor-pointer transition-colors
                                ${file ? 'border-violet-400 bg-violet-50' : 'border-gray-300 hover:border-violet-300 hover:bg-gray-50'}`}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={file ? '#7c3aed' : '#9ca3af'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
                            </svg>
                            <div>
                                <div className="text-xs font-semibold text-gray-600">{file ? file.name : 'Pick a shop drawing PDF'}</div>
                                {file && <div className="text-[10px] text-gray-400">{totalPages} page{totalPages > 1 ? 's' : ''}</div>}
                            </div>
                        </div>

                        {file && (
                            <div className="flex items-center gap-2 mt-2">
                                <div className="flex items-center gap-1 flex-1">
                                    <label className="text-[10px] text-gray-500 font-medium whitespace-nowrap">Page:</label>
                                    <input type="number" min={1} max={totalPages} value={pageNum}
                                        onChange={e => setPageNum(Math.max(1, Math.min(totalPages, parseInt(e.target.value) || 1)))}
                                        className="w-14 border border-gray-300 rounded px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400" />
                                    <span className="text-[10px] text-gray-400">/ {totalPages}</span>
                                </div>
                                <button onClick={handleReview} disabled={status === 'rendering' || status === 'reviewing'}
                                    className="flex-1 py-1.5 bg-violet-600 text-white rounded text-xs font-semibold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-wait transition-colors">
                                    {status === 'rendering' ? '⏳ Rendering…' : status === 'reviewing' ? '🤖 Reviewing…' : aiResult ? '↺ Re-review' : '🔍 Review Page'}
                                </button>
                            </div>
                        )}

                        {status === 'error' && (
                            <div className="mt-2 text-[10px] text-red-600 bg-red-50 rounded px-2 py-1 leading-snug">{error}</div>
                        )}

                        {/* After AI review — prompt to switch to manual */}
                        {status === 'done' && aiResult && (
                            <button onClick={() => setActiveTab('manual')}
                                className="mt-2 w-full py-1 border border-violet-300 text-violet-700 rounded text-[11px] font-semibold hover:bg-violet-50 transition-colors">
                                ✅ Review in Checklist tab →
                            </button>
                        )}
                    </div>

                    {/* AI results */}
                    {aiResult && (
                        <div className="flex-1 overflow-y-auto">
                            {/* Summary */}
                            <div className={`m-2 p-2 rounded-lg border ${GRADE_META[aiResult.grade]}`}>
                                <div className="flex items-center gap-2">
                                    <ScoreRing score={aiResult.overallScore} grade={aiResult.grade} />
                                    <div>
                                        <div className="flex items-center gap-1 mb-0.5">
                                            <span className="text-xs font-bold">AI Assessment</span>
                                            <span className={`text-[10px] px-1 rounded font-bold border ${GRADE_META[aiResult.grade]}`}>{aiResult.grade}</span>
                                        </div>
                                        <p className="text-[11px] leading-snug">{aiResult.summary}</p>
                                        <div className="flex gap-2 mt-1 text-[10px]">
                                            <span className="text-green-700">✓ {aiPass} pass</span>
                                            <span className="text-amber-700">⚠ {aiWarn} warn</span>
                                            <span className="text-red-700">✗ {aiFail} fail</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {aiResult.criticalIssues.length > 0 && (
                                <div className="mx-2 mb-2 bg-red-50 border border-red-200 rounded p-2">
                                    <p className="text-[10px] font-bold text-red-700 mb-1 uppercase tracking-wide">⚠ Critical Issues</p>
                                    <ul className="space-y-0.5">
                                        {aiResult.criticalIssues.map((issue, i) => (
                                            <li key={i} className="text-[11px] text-red-700 flex gap-1"><span>•</span>{issue}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="px-2 space-y-1 pb-2">
                                {CATEGORIES.map(cat => (
                                    <AiCategory key={cat} cat={cat} items={AWI_CHECKLIST} results={aiResult.items} />
                                ))}
                            </div>

                            {aiResult.recommendations.length > 0 && (
                                <div className="mx-2 mb-2 bg-indigo-50 border border-indigo-200 rounded p-2">
                                    <p className="text-[10px] font-bold text-indigo-700 mb-1 uppercase tracking-wide">💡 Recommendations</p>
                                    <ul className="space-y-0.5">
                                        {aiResult.recommendations.map((r, i) => (
                                            <li key={i} className="text-[11px] text-indigo-700 flex gap-1"><span>•</span>{r}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="mx-2 mb-3 text-[10px] text-gray-400 flex gap-2">
                                <span>Model: {aiResult.model}</span>
                                <span>•</span>
                                <span>{(aiResult.durationMs / 1000).toFixed(1)}s</span>
                            </div>
                        </div>
                    )}

                    {previewUrl && !aiResult && (
                        <div className="flex-1 flex items-center justify-center p-2">
                            <img src={previewUrl} alt="Page preview" className="max-w-full max-h-full rounded shadow border border-gray-200 object-contain" />
                        </div>
                    )}

                    {!file && status === 'idle' && (
                        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs px-4 text-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                                <path d="M12 8v4M12 16h.01" />
                            </svg>
                            <p>Upload a shop drawing PDF to auto-evaluate it for AWI Premium Grade compliance</p>
                            <p className="text-[10px] text-gray-300">AI reviews dimensions, joinery, material specs, hardware, and finish</p>
                            <p className="text-[10px] text-gray-300">Then switch to the <strong>✅ Checklist</strong> tab to review and override AI findings</p>
                            <button onClick={() => setShowSettings(true)} className="text-indigo-500 text-[10px] underline">Configure AI model →</button>
                        </div>
                    )}
                </div>
            )}

            {/* ════════════════════ MANUAL CHECKLIST TAB ════════════════════ */}
            {activeTab === 'manual' && (
                <div className="flex flex-col flex-1 overflow-hidden">
                    <div className="shrink-0 px-3 pt-2 pb-2 border-b border-gray-200">
                        <div className="flex items-center justify-between">
                            <h3 className="font-semibold text-gray-800 text-xs uppercase tracking-wide">AWI Premium Compliance Checklist</h3>
                            <div className="flex gap-1">
                                {/* Quick reset */}
                                <button onClick={() => setItemStates(emptyItemStates())}
                                    className="px-2 py-1 text-[10px] bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-500 transition-colors" title="Reset all items">
                                    ↺ Reset
                                </button>
                                {/* Jump to AI review */}
                                <button onClick={() => setActiveTab('ai')}
                                    className="px-2 py-1 text-[10px] bg-white border border-violet-300 text-violet-600 rounded hover:bg-violet-50 transition-colors">
                                    🤖 AI Review
                                </button>
                            </div>
                        </div>
                        {aiResult && (
                            <p className="text-[10px] text-violet-600 mt-1 bg-violet-50 rounded px-1.5 py-0.5">
                                🤖 AI results loaded — <span className="font-semibold">{aiPass} pass · {aiWarn} warn · {aiFail} fail</span>. Override any item using the toggle buttons below.
                            </p>
                        )}
                        {!aiResult && (
                            <p className="text-[10px] text-gray-400 mt-1">
                                Set each item manually, or run an AI review first to auto-populate.
                            </p>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                        {CATEGORIES.map(cat => (
                            <ManualCategory key={cat} cat={cat} items={AWI_CHECKLIST} states={itemStates} onUpdate={handleItemUpdate} />
                        ))}

                        {/* Export at bottom */}
                        <button onClick={handleExportReport}
                            className="w-full mt-2 py-2 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700 transition-colors">
                            ⬇ Export Compliance Report (JSON)
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
