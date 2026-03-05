export type MarkupType = 'text' | 'rectangle' | 'cloud' | 'callout' | 'polyline' | 'polygon'
  | 'line' | 'arrow'
  | 'measure-length' | 'measure-area' | 'measure-perimeter' | 'measure-count' | 'calibrate';

export type MeasureUnit = 'ft' | 'in' | 'm' | 'cm' | 'mm';

export interface ScaleConfig {
  pixelsPerUnit: number; // how many canvas pixels = 1 real-world unit
  unit: MeasureUnit;
  label: string; // e.g. "1in = 10ft"
}

export interface MarkupProperties {
  color: string;
  opacity: number;
  strokeWidth: number;
  fill?: string;
}

export interface Markup {
  id: string;
  type: MarkupType;
  pageNumber: number;
  author: string;
  createdAt: string;
  properties: MarkupProperties;
  geometry: any; // Coordinate data (Fabric.js JSON or custom)
}

// ── Collaboration ──────────────────────────────────────────────────────────

export interface Reviewer {
  /** Stable UUID, generated once and stored in localStorage */
  id: string;
  name: string;
  /** Hex color used for stroke, initials badge, and peer indicator */
  color: string;
}

export interface Comment {
  id: string;
  text: string;
  author: Reviewer;
  createdAt: string;
}

// ── Studio (Phase 13) ──────────────────────────────────────────────────────

export type MarkupStatus = 'open' | 'accepted' | 'rejected' | 'question';

export interface Project {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  name: string;
  storage_path: string;
  version: number;
  uploaded_by: string;
  uploaded_at: string;
}

export interface Session {
  id: string;
  file_id: string;
  name?: string;
  status: 'open' | 'closed';
  created_by: string;
  created_at: string;
  closed_at?: string;
}

export interface SessionMarkup {
  id: string;
  session_id: string;
  page_number: number;
  markup_data: any;
  author_id: string;
  author_name: string;
  author_color: string;
  status: MarkupStatus;
  created_at: string;
  updated_at: string;
}


