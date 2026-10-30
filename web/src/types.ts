export type Role = 'admin' | 'user';

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
  supports_images: boolean;
  max_upload_mb: number;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ImageAsset {
  id: string;
  url: string;
  original_name: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  images: ImageAsset[];
  created_at: string;
  draw_id?: string | null;
  kind?: 'chat' | 'reading' | 'proposal';
}

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

export interface CardReading {
  card_id: string;
  imagery: string;
  symbolism: string;
  interpretation: string;
  advice: string;
}

export interface Reading {
  cards: CardReading[];
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
  reading: Reading | null;
  created_at: string;
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: Message[];
  draws: Draw[];
}

export type SchemaType = 'chat_completions' | 'responses' | 'anthropic';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  model_id: string;
  schema_type: SchemaType;
  reasoning_effort: ReasoningEffort;
  supports_images: boolean;
  context_window: number;
  compression_threshold: number;
  max_output_tokens: number;
  is_default: boolean;
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
  supports_images: boolean;
  context_window: number;
  compression_threshold: number;
  max_output_tokens: number;
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
  totals: Omit<UsageRow, 'label'> & {
    estimated_requests: number;
  };
  by_user: UsageRow[];
  by_model: UsageRow[];
  daily: UsageRow[];
  recent: UsageEvent[];
}
