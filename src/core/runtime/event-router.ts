/**
 * EventRouter - Sequential event dispatch with backpressure handling
 *
 * Provides a simple queue for processing events one at a time.
 * Adapter-agnostic: works with any event source (Discord, Slack, etc.)
 */

import { logger } from '../../shared/logger.js';

/**
 * Generic event type - the router doesn't care about the event shape
 */
export interface RouterEvent {
  type: string;
  source: string;
  payload: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Handler function that processes events
 */
export type EventHandler<T extends RouterEvent = RouterEvent> = (event: T) => Promise<void>;

/**
 * Optional callbacks for queue lifecycle events
 */
export interface EventRouterCallbacks<T extends RouterEvent = RouterEvent> {
  /** Called when an event is enqueued (not first in queue) */
  onEnqueue?: (event: T, queuePosition: number) => Promise<void>;
  /** Called when an event starts processing */
  onDequeue?: (event: T) => Promise<void>;
  /** Called after an event is successfully processed */
  onProcessed?: (event: T) => Promise<void>;
  /** Called when an event processing fails */
  onError?: (event: T, error: Error) => Promise<void>;
}

export interface EventRouterConfig {
  /** Maximum queue size (default: 100) */
  maxQueueSize?: number;
  /** Name for logging purposes */
  name?: string;
}

/**
 * EventRouter handles sequential event dispatch with backpressure.
 *
 * Features:
 * - Events are processed one at a time (sequential)
 * - Backpressure: rejects new events when queue is full
 * - Optional lifecycle callbacks for UI feedback (e.g., reactions)
 * - Error isolation: one event failure doesn't stop the queue
 */
export class EventRouter<T extends RouterEvent = RouterEvent> {
  private queue: T[] = [];
  private isProcessing = false;
  private handler: EventHandler<T>;
  private callbacks: EventRouterCallbacks<T>;
  private maxQueueSize: number;
  private name: string;

  constructor(
    handler: EventHandler<T>,
    callbacks: EventRouterCallbacks<T> = {},
    config: EventRouterConfig = {}
  ) {
    this.handler = handler;
    this.callbacks = callbacks;
    this.maxQueueSize = config.maxQueueSize ?? 100;
    this.name = config.name ?? 'EventRouter';
  }

  /**
   * Enqueue an event for processing
   * @returns true if enqueued, false if queue is full (backpressure)
   */
  async enqueue(event: T): Promise<boolean> {
    // Backpressure: reject if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      logger.warn(`${this.name}: Queue full, rejecting event`, {
        type: event.type,
        queueSize: this.queue.length,
        maxQueueSize: this.maxQueueSize,
      });
      return false;
    }

    this.queue.push(event);
    const queuePosition = this.queue.length;

    logger.debug(`${this.name}: Event enqueued`, {
      type: event.type,
      source: event.source,
      queuePosition,
    });

    // Notify callback (useful for adding "waiting" reactions)
    // Called when there's already something being processed or queued ahead
    const isWaiting = this.isProcessing || queuePosition > 1;
    if (isWaiting && this.callbacks.onEnqueue) {
      try {
        await this.callbacks.onEnqueue(event, queuePosition);
      } catch {
        // Ignore callback errors
      }
    }

    // Start processing if not already
    this.processQueue();

    return true;
  }

  /**
   * Get current queue length
   */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if currently processing an event
   */
  get processing(): boolean {
    return this.isProcessing;
  }

  /**
   * Process queued events sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const event = this.queue.shift()!;

      // Notify dequeue callback (useful for removing "waiting" reactions)
      if (this.callbacks.onDequeue) {
        try {
          await this.callbacks.onDequeue(event);
        } catch {
          // Ignore callback errors
        }
      }

      try {
        await this.handler(event);

        // Notify success callback
        if (this.callbacks.onProcessed) {
          try {
            await this.callbacks.onProcessed(event);
          } catch {
            // Ignore callback errors
          }
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`${this.name}: Error processing event`, {
          type: event.type,
          source: event.source,
          error: err.message,
        });

        // Notify error callback
        if (this.callbacks.onError) {
          try {
            await this.callbacks.onError(event, err);
          } catch {
            // Ignore callback errors
          }
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Clear all queued events (does not stop current processing)
   */
  clear(): void {
    const cleared = this.queue.length;
    this.queue = [];
    logger.info(`${this.name}: Queue cleared`, { eventsCleared: cleared });
  }
}

/**
 * Create an EventRouter with the given handler and optional callbacks
 */
export function createEventRouter<T extends RouterEvent = RouterEvent>(
  handler: EventHandler<T>,
  callbacks?: EventRouterCallbacks<T>,
  config?: EventRouterConfig
): EventRouter<T> {
  return new EventRouter(handler, callbacks, config);
}
