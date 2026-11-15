import { supabase } from './supabase';

export type ArgoMode = 'ai' | 'rules';

export type ArgoChatResult = {
  agent: 'ARGO';
  conversationId: string;
  messageId: string;
  answer: string;
  mode: ArgoMode;
  model: string | null;
  role: string;
};

export const argo = {
  async chat(workspaceId: string, message: string, conversationId?: string): Promise<ArgoChatResult> {
    const { data, error } = await supabase.functions.invoke<ArgoChatResult>('argo-api', {
      body: {
        workspaceId,
        message,
        ...(conversationId ? { conversationId } : {}),
      },
    });

    if (error) {
      throw new Error(error.message || 'ARGO is temporarily unavailable. Please retry.');
    }
    if (!data || typeof data.answer !== 'string' || !data.conversationId) {
      throw new Error('ARGO returned an unexpected response. Please retry.');
    }
    return data;
  },
};
