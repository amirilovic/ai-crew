import { describe, it, expect, vi } from 'vitest';
import { EventRouter, createEventRouter, type RouterEvent } from '../core/runtime/event-router.js';

// Helper to create test events
function createEvent(type: string, source = 'test'): RouterEvent {
  return {
    type,
    source,
    payload: { data: type },
    timestamp: new Date(),
  };
}

// Helper to wait for all pending promises
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('EventRouter', () => {
  describe('basic functionality', () => {
    it('processes events sequentially', async () => {
      const processed: string[] = [];
      const handler = vi.fn(async (event: RouterEvent) => {
        processed.push(event.type);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const router = new EventRouter(handler);

      // Enqueue multiple events
      await router.enqueue(createEvent('first'));
      await router.enqueue(createEvent('second'));
      await router.enqueue(createEvent('third'));

      // Wait for processing to complete
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledTimes(3);
      expect(processed).toEqual(['first', 'second', 'third']);
    });

    it('returns true when event is enqueued successfully', async () => {
      const handler = vi.fn(async () => {});
      const router = new EventRouter(handler);

      const result = await router.enqueue(createEvent('test'));

      expect(result).toBe(true);
    });

    it('tracks queue length correctly', async () => {
      let resolveFirst: () => void;
      const firstPromise = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      const handler = vi.fn(async () => {
        await firstPromise;
      });

      const router = new EventRouter(handler);

      // Enqueue first event (will start processing)
      await router.enqueue(createEvent('first'));
      expect(router.queueLength).toBe(0); // Processing, not in queue

      // Enqueue more while first is processing
      await router.enqueue(createEvent('second'));
      await router.enqueue(createEvent('third'));

      expect(router.queueLength).toBe(2);
      expect(router.processing).toBe(true);

      // Complete first event
      resolveFirst!();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(router.queueLength).toBe(0);
    });

    it('handles handler errors gracefully', async () => {
      const handler = vi.fn(async (event: RouterEvent) => {
        if (event.type === 'fail') {
          throw new Error('Handler error');
        }
      });

      const router = new EventRouter(handler);

      await router.enqueue(createEvent('success'));
      await router.enqueue(createEvent('fail'));
      await router.enqueue(createEvent('after-fail'));

      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // All events should be processed despite error
      expect(handler).toHaveBeenCalledTimes(3);
    });
  });

  describe('backpressure', () => {
    it('rejects events when queue is full', async () => {
      let blockProcessing: () => void;
      const blocking = new Promise<void>((resolve) => {
        blockProcessing = resolve;
      });

      const handler = vi.fn(async () => {
        await blocking;
      });

      const router = new EventRouter(handler, {}, { maxQueueSize: 3 });

      // First event starts processing
      const first = await router.enqueue(createEvent('1'));
      expect(first).toBe(true);

      // Fill the queue
      const second = await router.enqueue(createEvent('2'));
      const third = await router.enqueue(createEvent('3'));
      const fourth = await router.enqueue(createEvent('4'));

      expect(second).toBe(true);
      expect(third).toBe(true);
      expect(fourth).toBe(true); // Queue has 3 items (excluding processing)

      // Queue is now full (3 items in queue)
      expect(router.queueLength).toBe(3);

      // This should be rejected
      const fifth = await router.enqueue(createEvent('5'));
      expect(fifth).toBe(false);

      // Cleanup
      blockProcessing!();
      await flushPromises();
    });
  });

  describe('callbacks', () => {
    it('calls onEnqueue for non-first events', async () => {
      // We need to ensure first event stays in the queue when second is added
      // The trick is that processQueue() shifts the event before awaiting the handler
      // So we need to block BEFORE the handler runs

      let handlerStarted = false;
      let blockProcessing: () => void;
      const blocking = new Promise<void>((resolve) => {
        blockProcessing = resolve;
      });

      const handler = vi.fn(async () => {
        handlerStarted = true;
        await blocking;
      });
      const onEnqueue = vi.fn(async () => {});

      const router = new EventRouter(handler, { onEnqueue });

      // First event - this will start processing but we need to wait for handler to start
      router.enqueue(createEvent('first'));
      expect(onEnqueue).not.toHaveBeenCalled(); // First event, no callback

      // Wait for processing to start (handler is called but blocked)
      while (!handlerStarted) {
        await flushPromises();
      }

      // Now while first event is being processed (handler blocked), enqueue more
      // These should trigger onEnqueue because queue already has an item being processed
      await router.enqueue(createEvent('second'));
      expect(onEnqueue).toHaveBeenCalledTimes(1);

      await router.enqueue(createEvent('third'));
      expect(onEnqueue).toHaveBeenCalledTimes(2);

      // Cleanup
      blockProcessing!();
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('calls onDequeue when processing starts', async () => {
      const handler = vi.fn(async () => {});
      const onDequeue = vi.fn(async () => {});

      const router = new EventRouter(handler, { onDequeue });

      await router.enqueue(createEvent('test'));
      await flushPromises();

      expect(onDequeue).toHaveBeenCalledTimes(1);
    });

    it('calls onProcessed after successful processing', async () => {
      const handler = vi.fn(async () => {});
      const onProcessed = vi.fn(async () => {});

      const router = new EventRouter(handler, { onProcessed });

      await router.enqueue(createEvent('test'));
      await flushPromises();

      expect(onProcessed).toHaveBeenCalledTimes(1);
    });

    it('calls onError when handler throws', async () => {
      const handler = vi.fn(async () => {
        throw new Error('Test error');
      });
      const onError = vi.fn(async () => {});

      const router = new EventRouter(handler, { onError });

      await router.enqueue(createEvent('test'));
      await flushPromises();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'test' }),
        expect.any(Error)
      );
    });

    it('continues processing even if callbacks throw', async () => {
      const handler = vi.fn(async () => {});
      const onProcessed = vi.fn(async () => {
        throw new Error('Callback error');
      });

      const router = new EventRouter(handler, { onProcessed });

      await router.enqueue(createEvent('first'));
      await router.enqueue(createEvent('second'));
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Both events should be processed despite callback error
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('clear', () => {
    it('removes all queued events', async () => {
      let blockProcessing: () => void;
      const blocking = new Promise<void>((resolve) => {
        blockProcessing = resolve;
      });

      const handler = vi.fn(async () => {
        await blocking;
      });

      const router = new EventRouter(handler);

      await router.enqueue(createEvent('first'));
      await router.enqueue(createEvent('second'));
      await router.enqueue(createEvent('third'));

      expect(router.queueLength).toBe(2);

      router.clear();

      expect(router.queueLength).toBe(0);

      blockProcessing!();
      await flushPromises();

      // Only first event was processed (was already processing)
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('createEventRouter factory', () => {
    it('creates a configured EventRouter', async () => {
      const handler = vi.fn(async () => {});
      const onProcessed = vi.fn(async () => {});

      const router = createEventRouter(
        handler,
        { onProcessed },
        { name: 'TestRouter', maxQueueSize: 50 }
      );

      await router.enqueue(createEvent('test'));
      await flushPromises();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(onProcessed).toHaveBeenCalledTimes(1);
    });
  });
});
