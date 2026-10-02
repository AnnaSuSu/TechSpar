import {
  CopilotServerEventSchema, InterviewStreamEventSchema, IndexRebuildEventSchema,
  type CopilotServerEvent, type InterviewDoneEvent, type IndexRebuildProgress, type IndexRebuildDone,
} from '@techspar/contracts/events';
import { consumeSSE } from './sse';

export type { CopilotServerEvent };

export function decodeCopilotEvent(raw: unknown): CopilotServerEvent {
  let value: unknown;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : undefined; }
  catch { throw new Error('Invalid Copilot event'); }
  const result = CopilotServerEventSchema.safeParse(value);
  if (!result.success) throw new Error('Invalid Copilot event');
  return result.data;
}

export interface ChatStreamCallbacks {
  onToken?: (token: string) => void;
  onDone?: (data: InterviewDoneEvent) => void;
  onError?: (error: Error) => void;
}

export interface RebuildIndexCallbacks {
  onProgress?: (data: IndexRebuildProgress) => void;
  onDone?: (data: IndexRebuildDone) => void;
  onError?: (error: Error) => void;
}

export async function consumeInterviewStream(res: Response, callbacks: ChatStreamCallbacks): Promise<void> {
  try {
    await consumeSSE(res, (value) => {
      const event = InterviewStreamEventSchema.safeParse(value);
      if (!event.success) throw new Error('Invalid interview event');
      return event.data;
    }, (event) => {
      if ('error' in event) throw new Error(event.error);
      if ('done' in event) { callbacks.onDone?.(event); return true; }
      callbacks.onToken?.(event.token);
    });
  } catch (error) {
    if (!callbacks.onError) throw error;
    callbacks.onError(error instanceof Error ? error : new Error('Interview stream failed'));
  }
}

export async function consumeIndexRebuildStream(res: Response, callbacks: RebuildIndexCallbacks): Promise<void> {
  try {
    await consumeSSE(res, (value) => {
      const event = IndexRebuildEventSchema.safeParse(value);
      if (!event.success) throw new Error('Invalid index rebuild event');
      return event.data;
    }, (event) => {
      if ('fatal' in event) throw new Error(event.error);
      if ('done' in event) { callbacks.onDone?.(event); return true; }
      callbacks.onProgress?.(event);
    });
  } catch (error) {
    if (!callbacks.onError) throw error;
    callbacks.onError(error instanceof Error ? error : new Error('Index rebuild stream failed'));
  }
}
