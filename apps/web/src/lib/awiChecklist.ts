/**
 * AWI Premium Grade Standards checklist for millwork shop drawing review.
 * Reference: AWI/AWMAC/WI Architectural Woodwork Standards, 3rd Edition.
 * Section references are approximate — users should verify against their spec.
 */

export interface AwiCheckItem {
    id: string;
    section: string;
    category: 'dimensions' | 'joinery' | 'material' | 'finish' | 'hardware' | 'drawing';
    description: string;
    premium: string;   // What AWI premium grade requires
}

/** Full AWI Premium Grade checklist — used as context for the AI prompt. */
export const AWI_CHECKLIST: AwiCheckItem[] = [
    // ── Drawing completeness ────────────────────────────────────────────────
    {
        id: 'D-01', section: '§ General', category: 'drawing',
        description: 'Drawing includes plan, elevation, and section views',
        premium: 'Required for all casework and millwork items'
    },
    {
        id: 'D-02', section: '§ General', category: 'drawing',
        description: 'All dimensions clearly labeled and legible',
        premium: 'All critical dimensions noted; tolerances ±1/16" or better'
    },
    {
        id: 'D-03', section: '§ General', category: 'drawing',
        description: 'Scale indicated and consistent with drawing content',
        premium: 'Scale bar or stated scale; must match dimensional annotations'
    },
    {
        id: 'D-04', section: '§ General', category: 'drawing',
        description: 'Revision history and drawing number visible in title block',
        premium: 'Required; revision cloud around changed areas'
    },

    // ── Dimensions ──────────────────────────────────────────────────────────
    {
        id: 'DIM-01', section: '§ 100', category: 'dimensions',
        description: 'Overall height, width, and depth dimensions match specification',
        premium: 'No element may deviate more than ±1/8" from specified dimensions'
    },
    {
        id: 'DIM-02', section: '§ 100', category: 'dimensions',
        description: 'Door and drawer opening dimensions are correctly sized',
        premium: 'Opening clearances per hardware manufacturer specs; minimum 1/8" reveal'
    },
    {
        id: 'DIM-03', section: '§ 200', category: 'dimensions',
        description: 'Countertop overhang dimensioned (typically 1" on exposed sides)',
        premium: 'Overhang minimum 3/4", maximum 2" without knee clearance support'
    },
    {
        id: 'DIM-04', section: '§ 100', category: 'dimensions',
        description: 'Shelf dimensions and spacing dimensioned',
        premium: 'Adjustable shelves: 3/4" min thickness; fixed: as specified'
    },

    // ── Joinery & Construction ─────────────────────────────────────────────
    {
        id: 'J-01', section: '§ 400', category: 'joinery',
        description: 'Face frame construction method indicated (face frame vs. frameless)',
        premium: 'Premium: 3/4" hardwood face frame or full frameless per spec'
    },
    {
        id: 'J-02', section: '§ 400', category: 'joinery',
        description: 'Toe kick height and setback dimensioned',
        premium: 'Standard toe kick: 3-5/8" H x 3" deep min'
    },
    {
        id: 'J-03', section: '§ 400', category: 'joinery',
        description: 'Cabinet back construction noted',
        premium: 'Premium: 1/2" min back panel; dadoed into sides'
    },
    {
        id: 'J-04', section: '§ 350', category: 'joinery',
        description: 'Drawer box construction method specified',
        premium: 'Premium: dovetail or box joint; 1/2" min sides; undermount slides'
    },
    {
        id: 'J-05', section: '§ 400', category: 'joinery',
        description: 'Scribing and filler strip locations indicated',
        premium: 'Required at wall, ceiling, and floor transitions'
    },

    // ── Material ────────────────────────────────────────────────────────────
    {
        id: 'M-01', section: '§ 200', category: 'material',
        description: 'Core material species/grade specified (plywood, MDF, particleboard)',
        premium: 'Premium: furniture-grade hardwood plywood; no particleboard cores'
    },
    {
        id: 'M-02', section: '§ 200', category: 'material',
        description: 'Veneer species and cut noted for exposed surfaces',
        premium: 'Veneer grade A or better; consistent grain match at doors/panels'
    },
    {
        id: 'M-03', section: '§ 200', category: 'material',
        description: 'Substrate thickness noted for all components',
        premium: 'Sides/tops: 3/4" min; doors: 3/4"; drawer fronts: 3/4"'
    },
    {
        id: 'M-04', section: '§ 300', category: 'material',
        description: 'Edgebanding type and thickness specified',
        premium: 'Premium: solid wood edgebanding 3/4" for exposed edges'
    },

    // ── Hardware ────────────────────────────────────────────────────────────
    {
        id: 'H-01', section: '§ 500', category: 'hardware',
        description: 'Hinge type, brand, and quantity specified per door',
        premium: 'Concealed European cup hinges, full overlay or inset per design'
    },
    {
        id: 'H-02', section: '§ 500', category: 'hardware',
        description: 'Drawer slide type, rating, and extension noted',
        premium: 'Premium: full-extension undermount slides, min 100 lb rating'
    },
    {
        id: 'H-03', section: '§ 500', category: 'hardware',
        description: 'Pull/knob hardware specification shown',
        premium: 'Location dimensioned from edge/corner (e.g., CL 1-1/4" from edge)'
    },
    {
        id: 'H-04', section: '§ 500', category: 'hardware',
        description: 'Adjustable shelf pin system noted',
        premium: 'System 32 holes or equivalent; 5mm pins; 32mm spacing'
    },

    // ── Finish ─────────────────────────────────────────────────────────────
    {
        id: 'F-01', section: '§ 600', category: 'finish',
        description: 'Finish type and sheen specified (catalyzed lacquer, WB poly, etc.)',
        premium: 'Catalyzed conversion finish; 3-coat minimum; fully cured'
    },
    {
        id: 'F-02', section: '§ 600', category: 'finish',
        description: 'Finish grade area designations shown (exposed, semi-exposed, concealed)',
        premium: 'Premium finish on all exposed surfaces; semi-exposed interior treated'
    },
    {
        id: 'F-03', section: '§ 600', category: 'finish',
        description: 'Sample or finish reference called out in notes',
        premium: 'Finish approval sample required before production'
    },
];

/** Generate the system prompt for the AI reviewer. */
export function buildAwiSystemPrompt(): string {
    const checklistText = AWI_CHECKLIST
        .map(c => `[${c.id}] ${c.section} — ${c.description}\n   AWI Premium: ${c.premium}`)
        .join('\n');

    return `You are an expert architectural woodwork reviewer specializing in AWI (Architectural Woodwork Institute) Premium Grade standards. You review shop drawings for millwork and casework to ensure they meet AWI Architectural Woodwork Standards, 3rd Edition, Premium Grade.

When reviewing a shop drawing image, you will evaluate it against the following AWI Premium Grade checklist:

${checklistText}

For each checklist item, evaluate whether the drawing:
- PASS: Clearly meets the requirement
- FAIL: Clearly does not meet the requirement
- WARN: May have an issue or the drawing is unclear
- N/A: Not applicable to this drawing type

IMPORTANT: Only flag items that are visible and relevant to the drawing shown. Do not speculate about items not visible.

Respond ONLY with valid JSON in this exact format:
{
  "summary": "one sentence overall assessment",
  "grade": "PASS" | "WARN" | "FAIL",
  "overallScore": 0-100,
  "items": [
    {
      "id": "D-01",
      "status": "PASS" | "FAIL" | "WARN" | "N/A",
      "note": "brief specific finding or null"
    }
  ],
  "criticalIssues": ["list of most important problems to fix"],
  "recommendations": ["list of suggested improvements"]
}`;
}
