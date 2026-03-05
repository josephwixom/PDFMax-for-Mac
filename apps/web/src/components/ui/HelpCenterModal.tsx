'use client';

import React, { useState, useEffect } from 'react';

interface HelpCenterModalProps {
    onClose: () => void;
    initialSection?: string;
}

/* ── Keyboard shortcuts (same data as old KeyboardHelpModal) ─────────────── */
const SHORTCUTS = [
    {
        group: 'General',
        items: [
            { keys: ['Ctrl', 'Z'], label: 'Undo' },
            { keys: ['Ctrl', 'Y'], label: 'Redo' },
            { keys: ['Ctrl', 'A'], label: 'Select all markups' },
            { keys: ['Delete'], label: 'Delete selected markup' },
            { keys: ['Escape'], label: 'Deselect / cancel drawing' },
            { keys: ['?'], label: 'Open this Help Center' },
        ],
    },
    {
        group: 'Navigation',
        items: [
            { keys: ['Scroll'], label: 'Zoom in / out' },
            { keys: ['Middle-click', 'drag'], label: 'Pan canvas' },
            { keys: ['+'], label: 'Zoom in' },
            { keys: ['-'], label: 'Zoom out' },
            { keys: ['0'], label: 'Reset zoom to 100%' },
        ],
    },
    {
        group: 'Drawing Tools',
        items: [
            { keys: ['Dbl-click'], label: 'Finish polyline / polygon / measure' },
            { keys: ['Enter'], label: 'Finish polyline / polygon / measure' },
            { keys: ['Escape'], label: 'Cancel current drawing' },
        ],
    },
    {
        group: 'Selection',
        items: [
            { keys: ['Click'], label: 'Select markup' },
            { keys: ['Del'], label: 'Delete selected' },
            { keys: ['Right-click'], label: 'Context menu (duplicate, style, delete)' },
        ],
    },
];

/* ── Section nav definitions ─────────────────────────────────────────────── */
const NAV = [
    { id: 'start', icon: '🚀', label: 'Getting Started' },
    { id: 'markup', icon: '✏️', label: 'Markup Tools' },
    { id: 'measure', icon: '📐', label: 'Measure Tools' },
    { id: 'forms', icon: '📝', label: 'Forms Tools' },
    { id: 'awi', icon: '🏛️', label: 'AWI Review' },
    { id: 'keys', icon: '⌨️', label: 'Keyboard Shortcuts' },
];

/* ── Shared sub-components ───────────────────────────────────────────────── */
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-xl font-bold text-gray-900 mb-1">{children}</h2>
);

const SectionIntro = ({ children }: { children: React.ReactNode }) => (
    <p className="text-sm text-gray-500 mb-6 leading-relaxed">{children}</p>
);

const SubHeading = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-[11px] font-bold uppercase tracking-widest text-blue-600 mb-3 mt-6 first:mt-0">{children}</h3>
);

interface ToolCardProps {
    icon?: string;
    name: string;
    desc: string;
    steps?: string[];
    tip?: string;
    badge?: string;
}
const ToolCard = ({ icon, name, desc, steps, tip, badge }: ToolCardProps) => (
    <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 overflow-hidden">
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
            {icon && <span className="text-xl shrink-0 mt-0.5">{icon}</span>}
            <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-gray-800">{name}</span>
                    {badge && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">{badge}</span>
                    )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
            </div>
        </div>
        {steps && steps.length > 0 && (
            <div className="px-4 pb-3">
                <ol className="space-y-1">
                    {steps.map((s, i) => (
                        <li key={i} className="flex gap-2 text-xs text-gray-600">
                            <span className="shrink-0 w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold text-[10px] flex items-center justify-center mt-px">{i + 1}</span>
                            {s}
                        </li>
                    ))}
                </ol>
            </div>
        )}
        {tip && (
            <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 flex gap-2">
                <span className="shrink-0 text-sm">💡</span>
                <p className="text-xs text-amber-800 leading-relaxed">{tip}</p>
            </div>
        )}
    </div>
);

const Kbd = ({ k }: { k: string }) => (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-gray-300 bg-gray-100 text-gray-700 font-mono text-[11px] shadow-sm whitespace-nowrap">{k}</kbd>
);

/* ── Section: Getting Started ─────────────────────────────────────────────── */
const SectionStart = () => (
    <div>
        <SectionTitle>Getting Started</SectionTitle>
        <SectionIntro>PDF Max is a professional PDF annotation and compliance review tool built for AEC and millwork workflows. Here's how to get up and running quickly.</SectionIntro>

        <SubHeading>Opening a PDF</SubHeading>
        <ToolCard icon="📂" name="Open a File" desc="Load any PDF, DWG, or DXF file into the viewer."
            steps={[
                'Click the file name area in the top-left toolbar.',
                'Choose a file from your computer via the file picker.',
                'The PDF renders with full vector fidelity — all existing markups and annotations are preserved.'
            ]}
            tip="PDFs exported from AutoCAD or Revit import at their native print resolution. Use 300 DPI or higher for best measurement accuracy."
        />
        <ToolCard icon="🖱️" name="Navigating the Canvas" desc="Pan and zoom to inspect any area of the drawing."
            steps={[
                'Scroll the mouse wheel to zoom in and out.',
                'Hold the middle mouse button and drag to pan.',
                'Click page thumbnails on the left sidebar to jump to any page.',
                'Use the + / − buttons or zoom % field in the bottom bar to set a precise zoom level.'
            ]}
        />
        <ToolCard icon="🔍" name="Search" desc="Full-text search across all pages, including OCR text."
            steps={[
                'Click Find in the toolbar or press Ctrl+F.',
                'Type your search term — results are highlighted in yellow across all pages.',
                'Click the arrows to step through matches.'
            ]}
            tip="If the PDF has no embedded text layer (e.g. a scanned drawing), enable OCR in the search panel to extract text first."
        />

        <SubHeading>Saving & Exporting</SubHeading>
        <ToolCard icon="💾" name="Auto-Save" desc="Your work saves automatically to Supabase cloud storage after every annotation change."
            tip="The green 'Saved ✓' indicator in the toolbar confirms the latest state has been persisted. No manual save is needed."
        />
        <ToolCard icon="📤" name="Export Options" desc="Export your marked-up PDF in several formats."
            steps={[
                'Click Export in the toolbar to open the drop-down.',
                'Choose Flattened PDF to embed all markups permanently into the PDF.',
                'Choose Native PDF to export with editable PDF annotations.',
                'Choose Print at Scale to open the print dialog with scale options.'
            ]}
        />
    </div>
);

/* ── Section: Markup Tools ───────────────────────────────────────────────── */
const SectionMarkup = () => (
    <div>
        <SectionTitle>Markup Tools</SectionTitle>
        <SectionIntro>All markup tools are in the Markup dropdown in the toolbar. Select a tool, draw on the PDF, then use the Properties panel on the right to adjust color, stroke width, and opacity.</SectionIntro>

        <SubHeading>Selection & Navigation</SubHeading>
        <ToolCard icon="↖️" name="Select (Arrow)" desc="Select and move existing markups on the canvas."
            steps={['Click any markup to select it.', 'Drag to move it.', 'Use the corner handles to resize.', 'Press Delete to remove the selected markup.']}
            tip="Right-click any selected markup to access Duplicate, Change Style, and Delete options."
        />

        <SubHeading>Shape Markups</SubHeading>
        <ToolCard icon="⬜" name="Rectangle" desc="Draw a rectangular callout box."
            steps={['Click and drag to define the rectangle bounds.', 'Style with fill color and stroke in the Properties panel.']}
        />
        <ToolCard icon="🔵" name="Ellipse" desc="Draw circular or oval markup shapes."
            steps={['Click and drag — hold Shift for a perfect circle.']}
        />
        <ToolCard icon="☁️" name="Cloud Shape (Revision Cloud)" desc="Draw a revision cloud — the standard shape for marking drawing changes."
            steps={['Click and drag to define the cloud boundary.', 'The cloud arc is computed automatically.']}
            tip="Revision clouds are required by most AEC firms to mark drawing changes per revision."
        />
        <ToolCard icon="⬟" name="Polygon" desc="Draw any closed multi-point shape."
            steps={['Click to place each vertex.', 'Double-click or press Enter to close the polygon.']}
        />

        <SubHeading>Line Markups</SubHeading>
        <ToolCard icon="➖" name="Line" desc="Draw a straight line between two points."
            steps={['Click to set Start, click to set End.']}
            tip="Hold Shift while drawing to constrain to 0°, 45°, or 90° angles."
        />
        <ToolCard icon="➡️" name="Arrow" desc="Same as Line but with an arrowhead on the end point." steps={['Click start, click end.']} />
        <ToolCard icon="〰️" name="Polyline" desc="A multi-segment open path, useful for routing paths or directional notes."
            steps={['Click to place each vertex.', 'Double-click or press Enter to finish.']}
        />

        <SubHeading>Text & Annotation</SubHeading>
        <ToolCard icon="T" name="Text Box" desc="Place a free-floating text annotation anywhere on the drawing."
            steps={['Click to place.', 'Type immediately — the box grows with content.', 'Click outside to confirm. Double-click to edit again.']}
        />
        <ToolCard icon="💬" name="Callout" desc="A text box with a leader line pointing to a specific feature."
            steps={['Click the callout origin (the feature being called out).', 'Drag to the text box location.', 'Release and type.']}
        />
        <ToolCard icon="🖊️" name="Freehand / Pen" desc="Draw freehand strokes directly on the drawing."
            tip="Use a stylus or tablet for best results. Freehand strokes are stored as paths with adjustable color and stroke width."
        />

        <SubHeading>Highlighting & Marking</SubHeading>
        <ToolCard icon="🟡" name="Highlight" desc="Draw a semi-transparent colored rectangle over text or areas of interest."
            steps={['Click and drag across the area to highlight.', 'The highlight draws at 35% opacity.']}
            tip="Change the highlight color in the color picker to use multiple highlight colors (yellow for note, red for issue, green for approval)."
        />
        <ToolCard icon="📌" name="Count / Pin" desc="Place numbered pins on the drawing — auto-increments with each click."
            steps={['Click anywhere on the drawing to place the next pin.', 'The counter auto-increments.', 'Reset the counter from the right-click context menu.']}
        />
        <ToolCard icon="■" name="Wipeout / Mask" desc="Cover a rectangular area with white — used to mask out portions of the drawing." steps={['Click and drag to define the masked area.']} />
        <ToolCard icon="🔒" name="Redaction" desc="Mark areas for redaction with a dashed red rectangle, then label." steps={['Click and drag to define the redaction region.', 'A REDACTED label is added automatically.']} />
        <ToolCard icon="🔺" name="Stamp" desc="Apply a pre-defined stamp (APPROVED, REJECTED, REVIEWED, etc.) to the drawing."
            steps={['Open the Stamp dropdown in the toolbar.', 'Click a stamp to select it.', 'Click the drawing to place it.', 'Upload custom images from your library.']}
        />
    </div>
);

/* ── Section: Measure Tools ──────────────────────────────────────────────── */
const SectionMeasure = () => (
    <div>
        <SectionTitle>Measure Tools</SectionTitle>
        <SectionIntro>Before measuring, calibrate the drawing scale using Set Scale. All measurements update automatically when the scale changes.</SectionIntro>

        <SubHeading>Scale Calibration</SubHeading>
        <ToolCard icon="📏" name="Set Scale" desc="Calibrate the drawing to a known real-world distance."
            steps={[
                'Click Set Scale in the bottom status bar.',
                'Click the start point of a known dimension on the drawing.',
                'Click the end point.',
                'Enter the real-world length (e.g. 48 in) in the dialog.',
                'All existing and future measurements update to the new scale.'
            ]}
            tip="Use a dimension line from the title block for accuracy. The Scale Widget shows your current scale (e.g. 1:48) in the bottom bar."
        />

        <SubHeading>Measurement Types</SubHeading>
        <ToolCard icon="↔️" name="Length" desc="Measure the straight-line distance between two points."
            steps={['Click start point → click end point.', 'The measurement label appears on the canvas.']}
            tip="Snap to PDF vector endpoints for sub-pixel accuracy. The snap indicator (blue square = endpoint, orange diamond = intersection) confirms a clean snap."
        />
        <ToolCard icon="🔲" name="Area" desc="Measure the area of any closed polygon."
            steps={['Click to define each vertex of the region.', 'Double-click or Enter to close and compute area.']}
        />
        <ToolCard icon="📦" name="Volume" desc="Compute volume by multiplying a measured area by a depth value."
            steps={['Draw an area as above.', 'Enter the depth in the dialog.', 'Volume = Area × Depth is displayed.']}
        />
        <ToolCard icon="🔁" name="Perimeter" desc="Measure the total perimeter of a closed polygon."
            steps={['Click each vertex.', 'Double-click to close — total perimeter is displayed.']}
        />
        <ToolCard icon="📐" name="Angle" desc="Measure the angle between three points (A → vertex → B)."
            steps={['Click point A.', 'Click the vertex (angle origin).', 'Click point B — the angle in degrees is displayed.']}
        />
        <ToolCard icon="🔢" name="Count" desc="Count items by clicking — a running total is maintained per page."
            tip="Use different colored pins to count different item types (hardware, fixtures, etc.)."
        />

        <SubHeading>Results & Export</SubHeading>
        <ToolCard icon="📊" name="Measurements Panel" desc="View all measurements for the current document in the bottom panel."
            steps={['Click the Measurements tab in the bottom panel.', 'All labeled measurements are listed with type, value, and units.']}
        />
        <ToolCard icon="📁" name="Export to CSV" desc="Export all measurements to a spreadsheet."
            steps={['Open the Measurements tab.', 'Click Export CSV.', 'A .csv file is downloaded with all measurement data.']}
        />
    </div>
);

/* ── Section: Forms Tools ────────────────────────────────────────────────── */
const SectionForms = () => (
    <div>
        <SectionTitle>Forms Tools</SectionTitle>
        <SectionIntro>Use Forms tools to create fillable fields on a PDF, or to fill in existing AcroForm fields embedded in the document.</SectionIntro>

        <SubHeading>Reading Existing Form Fields</SubHeading>
        <ToolCard icon="📋" name="Native AcroForm Fields" desc="When you open a PDF with existing form fields (AcroForms), they are detected automatically."
            steps={[
                'Open the PDF — existing form fields appear as interactive HTML overlays on the canvas.',
                'Click any field to type or change the value.',
                'Export → Flattened PDF to embed the filled values permanently.'
            ]}
            tip="AcroForm fields are overlaid on the canvas as interactive inputs but are rendered as part of the PDF on export."
        />

        <SubHeading>Creating New Form Fields</SubHeading>
        <ToolCard icon="T" name="Text Field" desc="Place a single-line text input on the document."
            steps={['Select Text Field from the Forms dropdown.', 'Click to place on the canvas.', 'Resize using the handles.']}
        />
        <ToolCard icon="☑️" name="Checkbox" desc="Place a toggleable checkbox on the document."
            steps={['Select Checkbox from the Forms dropdown.', 'Click to place.', 'Click the checkbox to toggle its state.']}
        />
        <ToolCard icon="▼" name="Dropdown" desc="Place a dropdown with selectable options."
            steps={['Select Dropdown from the Forms dropdown.', 'Click to place.', 'Edit options in the Properties panel.']}
        />
    </div>
);

/* ── Section: AWI Review ─────────────────────────────────────────────────── */
const SectionAwi = () => (
    <div>
        <SectionTitle>AWI Premium Grade Compliance Review</SectionTitle>
        <SectionIntro>PDF Max includes a built-in AWI (Architectural Woodwork Institute) Premium Grade compliance checker for millwork shop drawings. It combines AI-powered analysis with a structured manual checklist.</SectionIntro>

        <SubHeading>Opening the Review Panel</SubHeading>
        <ToolCard icon="🏛️" name="AWI Button" desc="Open the compliance review panel from the toolbar."
            steps={[
                'Click the amber AWI button in the top-right toolbar.',
                'A floating panel opens with two tabs: AI Review and Checklist.',
            ]}
        />

        <SubHeading>AI Review Tab</SubHeading>
        <ToolCard icon="🤖" name="Automated AI Analysis" desc="Use an AI model to automatically evaluate the shop drawing against all AWI Premium Grade checklist items."
            steps={[
                'In the AI Review tab, click Pick a shop drawing PDF.',
                'Select the drawing file to analyze.',
                'Choose your AI provider (OpenAI, Claude, or local Ollama) via Configure AI model.',
                'Click Run AI Review — the AI evaluates all 28 checklist items.',
                'Results appear with PASS / WARN / FAIL status for each item.',
                'Switch to the Checklist tab — AI results are pre-populated automatically.'
            ]}
            tip="The AI analyzes a rendered image of each page. Higher-resolution PDFs produce more accurate results. Use at least 150 DPI."
        />

        <SubHeading>Manual Checklist Tab</SubHeading>
        <ToolCard icon="✅" name="Manual Override Checklist" desc="28 AWI checklist items organized by category — manually set PASS, WARN, FAIL, or N/A for each."
            steps={[
                'Click the Checklist tab.',
                'For each item, click PASS / WARN / FAIL / N/A.',
                'Optionally add a note in the text field below each item.',
                'Items pre-populated by AI show an 🤖 AI badge. Items you override show a ✏️ Manual badge.',
                'The score ring at the top tracks your overall compliance percentage in real time.'
            ]}
            tip="Use the Reset button to clear all manual overrides and start fresh, or the AI Review shortcut button to re-run the AI analysis."
        />

        <SubHeading>Exporting the Report</SubHeading>
        <ToolCard icon="📥" name="Export Report" desc="Download a structured JSON report of the compliance review."
            steps={[
                'Complete the manual review (AI and/or manual).',
                'Click Export Report at the bottom of the Checklist tab.',
                'A .json file is downloaded with per-item status, notes, provenance (ai vs manual), and overall grade.'
            ]}
        />

        <SubHeading>AWI Checklist Categories</SubHeading>
        <div className="grid grid-cols-2 gap-2 text-xs">
            {[
                ['D', 'Drawing', 'Plan, elevation, section views; revision history'],
                ['DIM', 'Dimensions', 'Overall dims, openings, scale, tolerances'],
                ['MAT', 'Materials', 'Species, grade, sheet goods, exposed surfaces'],
                ['JOIN', 'Joinery', 'Panel construction, edge banding, fasteners'],
                ['HARD', 'Hardware', 'Schedule completeness, specs, installation notes'],
                ['FIN', 'Finish', 'Finish system, sheen, application surface call-outs'],
            ].map(([code, name, desc]) => (
                <div key={code} className="p-3 rounded-lg border border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{code}</span>
                        <span className="text-xs font-semibold text-gray-800">{name}</span>
                    </div>
                    <p className="text-[11px] text-gray-500 leading-snug">{desc}</p>
                </div>
            ))}
        </div>
    </div>
);

/* ── Section: Keyboard Shortcuts ─────────────────────────────────────────── */
const SectionKeys = () => (
    <div>
        <SectionTitle>Keyboard Shortcuts</SectionTitle>
        <SectionIntro>PDF Max supports keyboard shortcuts for all major actions. Press <Kbd k="?" /> anywhere to open this Help Center.</SectionIntro>
        <div className="grid grid-cols-2 gap-6">
            {SHORTCUTS.map((section) => (
                <div key={section.group}>
                    <SubHeading>{section.group}</SubHeading>
                    <div className="space-y-2">
                        {section.items.map((item) => (
                            <div key={item.label} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
                                <span className="text-xs text-gray-600 leading-tight">{item.label}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                    {item.keys.map((k, i) => (
                                        <React.Fragment key={k}>
                                            {i > 0 && <span className="text-gray-400 text-[10px]">+</span>}
                                            <Kbd k={k} />
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    </div>
);

/* ── Main modal ──────────────────────────────────────────────────────────── */
export const HelpCenterModal = ({ onClose, initialSection = 'start' }: HelpCenterModalProps) => {
    const [active, setActive] = useState(initialSection);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const SECTIONS: Record<string, React.ReactNode> = {
        start: <SectionStart />,
        markup: <SectionMarkup />,
        measure: <SectionMeasure />,
        forms: <SectionForms />,
        awi: <SectionAwi />,
        keys: <SectionKeys />,
    };

    return (
        <div
            className="fixed inset-0 z-[9998] flex items-stretch justify-end bg-black/40 backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            {/* Drawer */}
            <div
                className="w-full max-w-3xl bg-white flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
                onMouseDown={(e) => e.stopPropagation()}
                style={{ animation: 'slideInRight 0.2s ease-out' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-blue-600 to-blue-700 text-white shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" />
                            </svg>
                        </div>
                        <div>
                            <h1 className="font-bold text-base leading-none">PDF Max Help Center</h1>
                            <p className="text-blue-200 text-xs mt-0.5">Complete manual & reference guide</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/20 transition-colors" title="Close (Esc)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body: sidebar + content */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Left nav */}
                    <nav className="w-52 shrink-0 bg-gray-50 border-r border-gray-100 overflow-y-auto py-4">
                        {NAV.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setActive(item.id)}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors text-sm ${active === item.id
                                        ? 'bg-blue-50 text-blue-700 font-semibold border-r-2 border-blue-600'
                                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                                    }`}
                            >
                                <span className="text-base w-5 text-center">{item.icon}</span>
                                <span className="leading-tight">{item.label}</span>
                            </button>
                        ))}

                        {/* Footer in nav */}
                        <div className="mt-6 mx-4 p-3 rounded-xl bg-blue-50 border border-blue-100">
                            <p className="text-[11px] text-blue-800 font-semibold mb-1">PDF Max</p>
                            <p className="text-[10px] text-blue-600 leading-relaxed">AWI-certified shop drawing review platform for AEC professionals.</p>
                        </div>
                    </nav>

                    {/* Content */}
                    <main className="flex-1 overflow-y-auto p-7">
                        {SECTIONS[active]}
                    </main>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
                    <p className="text-[11px] text-gray-400">Press <Kbd k="Esc" /> to close • Press <Kbd k="?" /> to reopen</p>
                    <div className="flex items-center gap-2">
                        {NAV.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => setActive(item.id)}
                                title={item.label}
                                className={`w-6 h-6 rounded-full text-[11px] transition-colors flex items-center justify-center ${active === item.id ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-500'
                                    }`}
                            >
                                {item.icon}
                            </button>
                        ))}
                    </div>
                    <button onClick={onClose} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                        Got it
                    </button>
                </div>
            </div>

            <style jsx>{`
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to   { transform: translateX(0);    opacity: 1; }
                }
            `}</style>
        </div>
    );
};
