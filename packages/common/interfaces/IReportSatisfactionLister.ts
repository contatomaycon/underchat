export interface IReportSatisfactionElasticSatisfaction {
  question: string;
  options: { id: string; text: string }[];
  response: { id: string; text: string };
}

export interface IReportSatisfactionChatHit {
  _source?: {
    satisfaction_response?: IReportSatisfactionElasticSatisfaction;
    sector?: { id?: string; name?: string } | null;
    user?: { id?: string; name?: string } | null;
    date?: string;
    started_at?: string;
  };
}

export interface IReportSatisfactionTemplate {
  satisfaction_key: string;
  question: string;
  options: { id: string; text: string }[];
}
