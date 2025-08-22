import { describe, it, expect } from 'vitest';
import { createEffect } from 'solid-js';
import { testEffect } from '@solidjs/testing-library';
import { createYakStore } from './index';
import type { EventStreamInterface, Frame } from './types';

class MockEventStream implements EventStreamInterface {
  private frameCallback: ((frame: Frame) => void) | null = null;
  private casContent: Record<string, string> = {};
  private idCounter = 0;

  async appendEvent(_request: unknown): Promise<string> {
    return `mock-${++this.idCounter}`;
  }

  async getCasContent(hash: string): Promise<string> {
    return this.casContent[hash] || `content for ${hash}`;
  }

  async subscribeToEvents(): Promise<void> {
    return Promise.resolve();
  }

  onFrame(callback: (frame: Frame) => void): () => void {
    this.frameCallback = callback;
    return () => {
      this.frameCallback = null;
    };
  }

  emit(frame: Frame): void {
    if (frame.hash) {
      this.casContent[frame.hash] = `content for ${frame.id}`;
    }
    this.frameCallback?.(frame);
  }
}

describe('Yak Store - Clean Tests', () => {
  it('should create yak and update store state', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      // Initially empty
      expect(Object.keys(store.yaks())).toHaveLength(0);
      expect(store.currentYakId()).toBe('');

      createEffect(() => {
        const yaks = store.yaks();
        const yakIds = Object.keys(yaks);

        if (yakIds.length === 1) {
          // Yak was created
          expect(yakIds).toHaveLength(1);
          expect(yaks['yak-1']).toBeDefined();
          expect(yaks['yak-1'].id).toBe('yak-1');
          expect(store.currentYakId()).toBe('yak-1');
          done();
        }
      });

      // Emit a yak
      stream.emit({
        id: 'yak-1',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      });
    });
  });
});
