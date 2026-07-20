// Process-wide in-memory event bus singleton (#164). Extracted from server.ts so
// both the server bootstrap (which registers subscribers) and the extracted
// webhook/event routes (which publish) share one instance.
import { InMemoryEventBus } from "./event-bus";

export const eventBus = new InMemoryEventBus();
