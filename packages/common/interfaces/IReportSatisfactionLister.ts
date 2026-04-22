export interface IReportSatisfactionElasticSatisfaction {
  question: string;
  options: { id: string; text: string }[];
  response: { id: string; text: string };
  analyst?: { id?: string; name?: string } | null;
}

export interface IReportSatisfactionChatHit {
  _source?: {
    satisfaction_response?: IReportSatisfactionElasticSatisfaction;
    sector?: { id?: string; name?: string } | null;
    user?: { id?: string; name?: string } | null;
    contact?: {
      responsible_attendant?: { id?: string; name?: string } | null;
    } | null;
    secondary_users?:
      | { id?: string; name?: string; entered_at?: string | null }[]
      | null;
    date?: string;
    started_at?: string;
  };
}

export interface IReportSatisfactionTemplate {
  satisfaction_key: string;
  question: string;
  options: { id: string; text: string }[];
}
