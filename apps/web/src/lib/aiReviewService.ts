/**
 * AI Review Service — sends a rendered PDF page image to an AI vision model
 * for shop drawing analysis against AWI Premium Grade standards.
 *
 * Supports two providers:
 *  • OpenAI  — GPT-4o Vision (cloud, requires API key)
 *  • Ollama  — LLaVA / Mistral Vision (local, no key required)
 */

import { buildAwiSystemPrompt, AWI_CHECKLIST } from './awiChecklist';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AiProvider = 'openai' | 'ollama' | 'claude';

export interface AiProviderConfig {
    provider: AiProvider;
    apiKey?: string;          // required for OpenAI
    model?: string;           // default: gpt-4o for OpenAI, llava for Ollama
    baseUrl?: string;         // default: https://api.openai.com | http://localhost:11434
}

export interface ReviewItemResult {
    id: string;
    status: 'PASS' | 'FAIL' | 'WARN' | 'N/A';
    note: string | null;
}

export interface ReviewResult {
    summary: string;
    grade: 'PASS' | 'WARN' | 'FAIL';
    overallScore: number;
    items: ReviewItemResult[];
    criticalIssues: string[];
    recommendations: string[];
    provider: AiProvider;
    model: string;
    durationMs: number;
}

const DEFAULT_CONFIG: Required<AiProviderConfig> = {
    provider: 'claude',
    apiKey: '',
    model: 'claude-opus-4-5',
    baseUrl: 'https://api.anthropic.com',
};

// ─── Main review function ─────────────────────────────────────────────────────

/**
 * Review a canvas image against AWI Premium Grade standards.
 * @param canvas  The rendered PDF page canvas element
 * @param config  AI provider configuration
 * @returns       Structured ReviewResult with per-item pass/fail
 */
export async function reviewShopDrawing(
    canvas: HTMLCanvasElement,
    config: AiProviderConfig
): Promise<ReviewResult> {
    const t0 = Date.now();
    const base64 = canvasToBase64(canvas);
    const systemPrompt = buildAwiSystemPrompt();
    const userPrompt = 'Review this shop drawing image for AWI Premium Grade compliance. Evaluate all visible checklist items and return the JSON result.';

    const merged: Required<AiProviderConfig> = {
        provider: config.provider,
        apiKey: config.apiKey ?? '',
        model: config.model ?? (config.provider === 'openai' ? 'gpt-4o' : 'llava'),
        baseUrl: config.baseUrl ?? (config.provider === 'openai' ? 'https://api.openai.com' : 'http://localhost:11434'),
    };

    let raw: string;
    if (merged.provider === 'claude') {
        raw = await callClaude(base64, systemPrompt, userPrompt, merged);
    } else if (merged.provider === 'openai') {
        raw = await callOpenAI(base64, systemPrompt, userPrompt, merged);
    } else {
        raw = await callOllama(base64, systemPrompt, userPrompt, merged);
    }

    const result = parseAiResponse(raw, merged);
    result.durationMs = Date.now() - t0;
    return result;
}

// ─── Anthropic (Claude) provider ──────────────────────────────────────────────

async function callClaude(
    base64: string,
    system: string,
    user: string,
    cfg: Required<AiProviderConfig>
): Promise<string> {
    const resp = await fetch(`${cfg.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
            model: cfg.model,
            max_tokens: 2048,
            system,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/png',
                            data: base64,
                        },
                    },
                    { type: 'text', text: user },
                ],
            }],
        }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`Claude error ${resp.status}: ${(err as any)?.error?.message ?? resp.statusText}`);
    }

    const data = await resp.json();
    return data.content?.[0]?.text ?? '';
}

// ─── OpenAI provider ──────────────────────────────────────────────────────────

async function callOpenAI(
    base64: string,
    system: string,
    user: string,
    cfg: Required<AiProviderConfig>
): Promise<string> {
    const resp = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
            model: cfg.model,
            max_tokens: 2048,
            messages: [
                { role: 'system', content: system },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: user },
                        {
                            type: 'image_url',
                            image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' },
                        },
                    ],
                },
            ],
        }),
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(`OpenAI error ${resp.status}: ${(err as any)?.error?.message ?? resp.statusText}`);
    }

    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? '';
}

// ─── Ollama provider ──────────────────────────────────────────────────────────

async function callOllama(
    base64: string,
    system: string,
    user: string,
    cfg: Required<AiProviderConfig>
): Promise<string> {
    // Ollama /api/generate endpoint with images array
    const resp = await fetch(`${cfg.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: cfg.model,
            system,
            prompt: user,
            images: [base64],
            stream: false,
            options: { num_predict: 2048, temperature: 0.1 },
        }),
    });

    if (!resp.ok) {
        throw new Error(`Ollama error ${resp.status}: ${resp.statusText}. Is Ollama running? Start with: ollama serve`);
    }

    const data = await resp.json();
    return data.response ?? '';
}

// ─── Response parsing ─────────────────────────────────────────────────────────

function parseAiResponse(raw: string, cfg: Required<AiProviderConfig>): ReviewResult {
    // Extract JSON from markdown code block if wrapped
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch?.[1] ?? raw;

    try {
        const parsed = JSON.parse(jsonStr.trim()) as ReviewResult;
        // Fill in any missing item results with N/A
        const allIds = AWI_CHECKLIST.map(c => c.id);
        const presentIds = new Set(parsed.items?.map(i => i.id) ?? []);
        for (const id of allIds) {
            if (!presentIds.has(id)) {
                parsed.items = parsed.items ?? [];
                parsed.items.push({ id, status: 'N/A', note: null });
            }
        }
        return {
            ...parsed,
            provider: cfg.provider,
            model: cfg.model,
            durationMs: 0,
        };
    } catch {
        // Fallback: return a parse-error result
        return {
            summary: 'AI response could not be parsed. The model may not support vision or returned unexpected text.',
            grade: 'WARN',
            overallScore: 0,
            items: AWI_CHECKLIST.map(c => ({ id: c.id, status: 'N/A' as const, note: null })),
            criticalIssues: ['AI response parse error — check model and API key'],
            recommendations: ['Ensure the model supports vision: gpt-4o (OpenAI) or llava (Ollama)'],
            provider: cfg.provider,
            model: cfg.model,
            durationMs: 0,
        };
    }
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

/** Render a PDF page to a canvas and return it at 2× scale for AI clarity. */
export async function renderPageForAiReview(
    pdfData: ArrayBuffer,
    pageNum: number
): Promise<HTMLCanvasElement> {
    const pdfjsLib = await import('pdfjs-dist');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfData) }).promise;
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(viewport.width, 2048);
    canvas.height = Math.min(viewport.height, 2048);
    const scale = Math.min(1, 2048 / Math.max(viewport.width, viewport.height));
    const vp2 = page.getViewport({ scale: 2.0 * scale });
    canvas.width = vp2.width;
    canvas.height = vp2.height;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx as any, viewport: vp2 }).promise;
    return canvas;
}

function canvasToBase64(canvas: HTMLCanvasElement): string {
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.split(',')[1] ?? '';
}

// ─── Settings persistence ─────────────────────────────────────────────────────

const CONFIG_KEY = 'pdfmax:ai-config';

export function loadAiConfig(): AiProviderConfig {
    try {
        const raw = localStorage.getItem(CONFIG_KEY);
        return raw ? JSON.parse(raw) : { provider: 'openai', model: 'gpt-4o' };
    } catch { return { provider: 'openai', model: 'gpt-4o' }; }
}

export function saveAiConfig(cfg: AiProviderConfig): void {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}
