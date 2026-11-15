import { supabase } from './supabase';

export type ArgoMode = 'ai' | 'rules';
export type ArgoChatResult = {
  agent: 'ARGO'; conversationId: string; messageId: string; answer: string;
  mode: ArgoMode; model: string | null; role: string;
};
export type ArgoAction = {
  id: string; action_type: string; payload: Record<string, unknown>;
  rationale: string; status: string; created_at: string;
};
export type ArgoPrediction = {
  leadId: string; name: string; score: number; band: 'High' | 'Medium' | 'Low';
  reasons: string[]; nextBestAction: string;
};

async function invoke<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(path, { body });
  if (error) throw new Error(error.message || 'ARGO request failed.');
  if (!data) throw new Error('ARGO returned an empty response.');
  return data;
}

export const argo = {
  async chat(workspaceId: string, message: string, conversationId?: string): Promise<ArgoChatResult> {
    const data = await invoke<ArgoChatResult>('argo-api', {
      workspaceId, message, ...(conversationId ? { conversationId } : {}),
    });
    if (typeof data.answer !== 'string' || !data.conversationId) throw new Error('ARGO returned an unexpected response.');
    return data;
  },
  async listActions(workspaceId: string) {
    return invoke<{ items: ArgoAction[] }>('argo-api/actions', { workspaceId, operation: 'list' });
  },
  async predictions(workspaceId: string) {
    return invoke<{ predictions: ArgoPrediction[]; sampleSize: number; closedOutcomes: number; calibrated: boolean; disclaimer: string }>('argo-api/predictions', { workspaceId });
  },
  async communicationsStatus(workspaceId: string) {
    return invoke<{ whatsapp: { connected: boolean; status: string }; sms: { configured: boolean }; voice: { configured: boolean }; callWebhook: { configured: boolean; provider: string | null } }>('argo-api/communications/status', { workspaceId });
  },
  async proposeAction(workspaceId: string, actionType: string, payload: Record<string, unknown>, rationale: string) {
    return invoke<{ created: boolean; item: ArgoAction }>('argo-api/actions', { workspaceId, actionType, payload, rationale });
  },
  async approveAction(workspaceId: string, actionId: string) {
    return invoke<{ approved: boolean }>(`argo-api/actions/${actionId}/approve`, { workspaceId });
  },
  async rejectAction(workspaceId: string, actionId: string) {
    return invoke<{ rejected: boolean }>(`argo-api/actions/${actionId}/reject`, { workspaceId });
  },
  async executeAction(workspaceId: string, actionId: string) {
    return invoke<{ executed: boolean; result: unknown }>(`argo-api/actions/${actionId}/execute`, { workspaceId });
  },
};
