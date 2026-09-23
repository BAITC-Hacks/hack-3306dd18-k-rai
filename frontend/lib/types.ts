export type Role =
  | "consolidator"
  | "coordinator"
  | "distributor"
  | "transit"
  | "terminal"
  | "peripheral";

export interface GraphNode {
  id: number; // gid
  role: Role;
  role_score: number; // 0..1, уверенность в роли
  cluster_id: number;
  priority_score: number; // 0..1
  depth: number; // 0 = seed-уровень, 1..4 — колено
  is_seed: boolean;
  in_senders: number; // уникальных отправителей
  out_receivers: number; // уникальных получателей
  sum_in: number; // ₸
  sum_out: number; // ₸
  is_cutoff: boolean; // обрыв выгрузки на 4-м колене
  evidence: string; // почему такая роль, до 200 символов
}

export interface GraphLink {
  source: number; // gid отправителя
  target: number; // gid получателя
  sum_kzt: number;
  n_tx: number;
}

export interface Cluster {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: number;
  top_gids: number[];
  hypothesis: string;
}

export interface TopItem {
  rank: number;
  gid: number;
  role: Role;
  priority_score: number;
  why: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  clusters: Cluster[];
  top: TopItem[];
}

export interface AskRequest {
  question: string;
  selected_gids?: number[]; // узлы, выделенные пользователем
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface AskResponse {
  answer: string;
  steps: AgentStep[];
  highlight_gids: number[];
  error?: string;
  /** Чем отвечал бэкенд: 'llm' — модель, иное значение — запасной режим. */
  mode?: string;
  /** Причина, по которой модель не отработала, если ответ пришёл из запасного режима. */
  llm_error?: string;
}
