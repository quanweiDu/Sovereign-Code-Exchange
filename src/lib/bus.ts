// Layer 2: the Sovereign asynchronous event bus.
// A minimal, dependency-free async pub/sub used by the meta-kernel to broadcast
// lifecycle events (asset.registered, asset.executed, asset.quarantined,
// royalty.credited, execution.finished, ...). Handlers are awaited in order;
// a failing handler never breaks the pipeline.

export type EventPayload = Record<string, unknown>;
export type EventHandler = (type: string, payload: EventPayload) => void | Promise<void>;

const handlers: EventHandler[] = [];

export function onEvent(handler: EventHandler): void {
  handlers.push(handler);
}

export async function emit(type: string, payload: EventPayload): Promise<void> {
  for (const handler of handlers) {
    try {
      await handler(type, payload);
    } catch {
      // The bus must never crash the kernel because of a subscriber.
    }
  }
}
