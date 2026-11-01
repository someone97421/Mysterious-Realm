export type Role = 'admin' | 'user';
export type Mode = 'tarot' | 'astrology';

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface AppConfig {
  app_name: string;
  model_ready: boolean;
  tarot_model_ready?: boolean;
  astrology_model_ready?: boolean;
  supports_images: boolean;
  tarot_supports_images?: boolean;
  astrology_supports_images?: boolean;
  max_upload_mb: number;
}

export interface Conversation {
  id: string;
  title: string;
  mode: Mode;
  created_at: string;
  updated_at: string;
}

export interface ImageAsset {
  id: string;
  url: string;
  original_name: string;
}

export interface Profile {
  id: string; name: string; avatar: string; color: string;
  birth_date: string | null; birth_time: string | null; time_accuracy: TimeAccuracy; time_end: string | null;
  location_name: string | null; latitude: number | null; longitude: number | null; timezone: string | null;
  notes: string; version: number; created_at: string; updated_at: string;
}
export type TimeAccuracy = 'exact' | 'approximate' | 'range' | 'unknown';
export interface Location { name: string; latitude: number; longitude: number; timezone: string | null }

export interface TarotCard {
  id: string;
  name_zh: string;
  name_en: string;
  arcana: 'major' | 'minor';
  suit: string | null;
  orientation: 'upright' | 'reversed';
  orientation_zh: string;
  image_url: string;
  position: string;
}
export interface TarotCardReading {
  card_id: string;
  imagery: string;
  symbolism: string;
  interpretation: string;
  advice: string;
}
export interface TarotReading {
  cards: TarotCardReading[];
  synthesis: string;
  actions: string[];
  closing: string;
}
export interface Draw {
  id: string;
  conversation_id: string;
  status: 'proposed' | 'drawn' | 'interpreted';
  question: string;
  opening: string;
  spread_name: string;
  positions: string[];
  upright_only: boolean;
  cards: TarotCard[];
  reading: TarotReading | null;
  created_at: string;
}

export type ReadingLayout = 'natal' | 'relationship' | 'forecast' | 'decision';
export interface ReadingSection { id: string; title: string; body: string; highlights: string[] }
export interface ReadingSource { name: string; url: string }
export interface AstroReading {
  layout: ReadingLayout; title: string; subtitle: string; summary: string;
  sections: ReadingSection[]; actions: string[]; closing: string; sources: ReadingSource[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images: ImageAsset[];
  profiles: Profile[];
  created_at: string;
  reasoning?: string;
  draw_id?: string | null;
  kind?: string;
  reading?: AstroReading | null;
}

export interface Planet { id: string; name: string; longitude: number; sign?: string; house?: number; retrograde?: boolean }
export interface House { number: number; longitude: number }
export interface Aspect { from: string; to: string; angle: number; orb?: number }
export interface Chart {
  id: string; kind: string; title: string; profile_ids: string[]; created_at: string;
  planets: Planet[]; houses: House[]; aspects: Aspect[]; outer_planets: Planet[];
  inner_label?: string; outer_label?: string;
  source: { name: string; url: string } | null; warnings: string[];
}
export interface Progress { id: string; text: string; state: 'running' | 'complete' | 'error'; created_at: string }
export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  draws: Draw[];
  charts: Chart[];
  progress: Progress[];
  active: boolean;
}

export type LengthMode = 'concise' | 'detailed';
export type AstrologyProvider = 'cosmyday' | 'astroway';
export interface AstrologyService {
  id: string; name: string; provider: AstrologyProvider; enabled: boolean; priority: number;
  has_api_key: boolean; created_at: string; updated_at: string;
}
export interface AstrologySettings {
  services: AstrologyService[];
  allow_credit_spend: boolean; allow_unknown_cost: boolean; max_credits: number | null; timeout: number;
  cache_enabled: boolean; enabled_tools: string[];
}
export interface Pagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}
export interface Retention {
  days: number;
  max_rows: number;
}
export interface ToolUsage {
  recent: { id: string; tool: string; provider: string; status: string; credits: number | null; cache_hit: boolean; created_at: string; error_code: string | null }[];
  totals: { calls: number; credits: number | null; known_credits: number; unknown_calls: number; cache_hits: number };
  pagination: Pagination;
  retention: Retention;
}

export type SchemaType = 'chat_completions' | 'responses' | 'anthropic';
export type ReasoningEffort = string;
export type ModelScope = 'both' | Mode;
export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  model_id: string;
  schema_type: SchemaType;
  reasoning_effort: ReasoningEffort;
  reasoning_field: string;
  supports_images: boolean;
  context_window: number;
  compression_threshold: number;
  max_output_tokens: number;
  is_default: boolean;
  mode_scope: ModelScope;
  is_default_tarot: boolean;
  is_default_astrology: boolean;
  has_api_key: boolean;
  created_at: string;
}
export interface ModelPayload {
  name: string;
  provider: string;
  base_url: string;
  model_id: string;
  schema_type: SchemaType;
  reasoning_effort: ReasoningEffort;
  reasoning_field: string;
  supports_images: boolean;
  context_window: number;
  compression_threshold: number;
  max_output_tokens: number;
  mode_scope: ModelScope;
  is_default_tarot?: boolean;
  is_default_astrology?: boolean;
  api_key?: string;
}

export interface UsageRow {
  label: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_hit_rate: number | null;
  requests: number;
}
export interface UsageEvent {
  id: string;
  created_at: string;
  username: string;
  model_name: string;
  purpose: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number | null;
  estimated: boolean;
}
export interface UsageStats {
  totals: Omit<UsageRow, 'label'> & { estimated_requests: number };
  by_user: UsageRow[];
  by_model: UsageRow[];
  daily: UsageRow[];
  recent: UsageEvent[];
  pagination: Pagination;
  retention: Retention;
}
