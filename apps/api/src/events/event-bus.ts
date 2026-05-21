type EventHandler<T> = (event: T) => void;

export interface PlatformEvent {
  type: string;
  hotelId: string;
  payload: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export class InMemoryEventBus {
  private readonly listeners = new Map<string, EventHandler<PlatformEvent>[]>();

  publish(event: PlatformEvent) {
    const handlers = this.listeners.get(event.type) ?? [];
    for (const handler of handlers) {
      handler(event);
    }
  }

  subscribe(type: string, handler: EventHandler<PlatformEvent>) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
}
