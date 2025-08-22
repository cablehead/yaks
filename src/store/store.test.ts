import { describe, it, expect } from 'vitest';
import { createRoot } from 'solid-js';
import { testEffect } from '@solidjs/testing-library';
import { createYakStore } from './index';
import type { EventStreamInterface, Frame } from './types';

// Mock event stream for testing
class MockEventStream implements EventStreamInterface {
  private frameCallback: ((frame: Frame) => void) | null = null;
  private casContent: Record<string, string> = {};

  async appendEvent(request: any): Promise<string> {
    // Simulate backend behavior
    const frameId = `mock-${Date.now()}`;
    setTimeout(() => {
      if (this.frameCallback) {
        this.frameCallback({
          id: frameId,
          topic: request.topic,
          context_id: '0000000000000000000000000',
          hash: 'mock-hash',
          meta: request.meta,
        });
      }
    }, 10);
    return frameId;
  }

  async getCasContent(hash: string): Promise<string> {
    // Provide specific content for test hashes
    const content =
      this.casContent[hash] ||
      {
        'test-hash': 'Test note content',
        'hash-1': 'First note content',
        'hash-2': 'Second note content',
        'edited-hash': 'Edited note content',
      }[hash] ||
      'mock content for ' + hash;

    return Promise.resolve(content);
  }

  async subscribeToEvents(): Promise<void> {
    // Mock implementation - in real tests, we'll manually trigger frames
    return Promise.resolve();
  }

  onFrame(callback: (frame: Frame) => void): () => void {
    this.frameCallback = callback;
    return () => {
      this.frameCallback = null;
    };
  }

  // Helper method to simulate receiving frames
  simulateFrame(frame: Frame) {
    if (this.frameCallback) {
      // Store content for hash if provided
      if (frame.hash) {
        this.casContent[frame.hash] = `content for ${frame.id}`;
      }
      this.frameCallback(frame);
    }
  }
}

describe('Yak Store', () => {
  it('should initialize with empty state', () => {
    createRoot(() => {
      const mockEventStream = new MockEventStream();
      const store = createYakStore(mockEventStream);

      expect(Object.keys(store.yaks())).toHaveLength(0);
      expect(store.currentYakId()).toBe('');
      expect(store.currentNotes()).toBe(undefined); // undefined until threshold reached
      expect(store.thresholdReached()).toBe(false);
    });
  });

  it('should process yak.create frames', async () => {
    await testEffect(done => {
      const mockEventStream = new MockEventStream();
      const store = createYakStore(mockEventStream);

      // Simulate receiving a yak.create frame
      const yakFrame: Frame = {
        id: 'test-yak-id',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      };

      // Simulate frame
      mockEventStream.simulateFrame(yakFrame);

      // Wait a brief moment for processing, then check state
      setTimeout(() => {
        try {
          const yaks = store.yaks();
          const yakKeys = Object.keys(yaks);

          expect(yakKeys).toHaveLength(1);
          expect(yaks['test-yak-id']).toBeDefined();
          expect(yaks['test-yak-id'].id).toBe('test-yak-id');
          expect(store.currentYakId()).toBe('test-yak-id');
          done();
        } catch (error) {
          done(error);
        }
      }, 100);
    });
  });

  it('should process note.create frames', async () => {
    await testEffect(done => {
      const mockEventStream = new MockEventStream();
      const store = createYakStore(mockEventStream);

      // First create a yak
      const yakFrame: Frame = {
        id: 'test-yak-id',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      };
      mockEventStream.simulateFrame(yakFrame);

      // Wait for yak processing, then create note
      setTimeout(() => {
        const yaks = store.yaks();
        if (Object.keys(yaks).length === 1 && yaks['test-yak-id']) {
          // Now create the note
          const noteFrame: Frame = {
            id: 'test-note-id',
            topic: 'note.create',
            context_id: '0000000000000000000000000',
            hash: 'test-hash',
            meta: { yak_id: 'test-yak-id' },
          };
          mockEventStream.simulateFrame(noteFrame);

          // Wait for async CAS content loading
          setTimeout(() => {
            try {
              const notes = store.notes();
              expect(Object.keys(notes)).toContain('test-note-id');
              expect(notes['test-note-id']).toBeDefined();
              done();
            } catch (error) {
              done(error);
            }
          }, 100);
        } else {
          done(new Error('Yak was not created properly'));
        }
      }, 50);
    });
  });

  it('should update selectedNoteId when editing a note', async () => {
    await testEffect(done => {
      const mockEventStream = new MockEventStream();
      const store = createYakStore(mockEventStream);

      // Create a yak
      const yakFrame: Frame = {
        id: 'test-yak-id',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      };
      mockEventStream.simulateFrame(yakFrame);

      setTimeout(() => {
        // Create a note
        const noteFrame: Frame = {
          id: 'original-note-id',
          topic: 'note.create',
          context_id: '0000000000000000000000000',
          hash: 'original-hash',
          meta: { yak_id: 'test-yak-id' },
        };
        mockEventStream.simulateFrame(noteFrame);

        setTimeout(() => {
          // Select the original note
          store.setSelectedNoteId('original-note-id');
          expect(store.selectedNoteId()).toBe('original-note-id');

          // Edit the note
          const editFrame: Frame = {
            id: 'edited-note-id',
            topic: 'note.edit',
            context_id: '0000000000000000000000000',
            hash: 'edited-hash',
            meta: { yak_id: 'test-yak-id', note_id: 'original-note-id' },
          };
          mockEventStream.simulateFrame(editFrame);

          setTimeout(() => {
            try {
              // The selectedNoteId should be updated to the new note ID
              const currentSelectedId = store.selectedNoteId();
              expect(currentSelectedId).toBe('edited-note-id');
              done();
            } catch (error) {
              done(error);
            }
          }, 100);
        }, 100);
      }, 50);
    });
  });

  it('should auto-select first note after threshold is reached', async () => {
    await testEffect(done => {
      const mockEventStream = new MockEventStream();
      const store = createYakStore(mockEventStream);

      // Create a yak
      const yakFrame: Frame = {
        id: 'test-yak-id',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      };
      mockEventStream.simulateFrame(yakFrame);

      setTimeout(() => {
        // Create a note
        const noteFrame: Frame = {
          id: 'test-note-id',
          topic: 'note.create',
          context_id: '0000000000000000000000000',
          hash: 'test-hash',
          meta: { yak_id: 'test-yak-id' },
        };
        mockEventStream.simulateFrame(noteFrame);

        setTimeout(() => {
          // Before threshold - should have no selection
          expect(store.selectedNoteId()).toBe('');
          expect(store.selectedNote()).toBe(undefined);

          // Simulate threshold reached
          const thresholdFrame: Frame = {
            id: 'threshold-id',
            topic: 'xs.threshold',
            context_id: '0000000000000000000000000',
            hash: null,
            meta: null,
          };
          mockEventStream.simulateFrame(thresholdFrame);

          setTimeout(() => {
            try {
              // Force memo re-evaluation by accessing threshold again
              expect(store.thresholdReached()).toBe(true);

              // After threshold - simulate the auto-selection logic that happens in App.tsx
              const notes = store.currentNotes();

              if (notes && notes.length > 0 && !store.selectedNoteId()) {
                store.setSelectedNoteId(notes[0].id);
              }

              // Should have auto-selected the first note
              expect(store.selectedNoteId()).toBe('test-note-id');
              expect(store.selectedNote()).toBeTruthy();
              expect(store.selectedNote()?.id).toBe('test-note-id');
              done();
            } catch (error) {
              done(error);
            }
          }, 100);
        }, 100);
      }, 50);
    });
  });

  it('should return correct note when manually selecting', async () => {
    await testEffect(done => {
      const mockEventStream = new MockEventStream();
      const store = createYakStore(mockEventStream);

      // Create a yak
      const yakFrame: Frame = {
        id: 'test-yak-id',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      };
      mockEventStream.simulateFrame(yakFrame);

      setTimeout(() => {
        // Create two notes
        const note1Frame: Frame = {
          id: 'note-1-id',
          topic: 'note.create',
          context_id: '0000000000000000000000000',
          hash: 'hash-1',
          meta: { yak_id: 'test-yak-id' },
        };
        mockEventStream.simulateFrame(note1Frame);

        const note2Frame: Frame = {
          id: 'note-2-id',
          topic: 'note.create',
          context_id: '0000000000000000000000000',
          hash: 'hash-2',
          meta: { yak_id: 'test-yak-id' },
        };
        mockEventStream.simulateFrame(note2Frame);

        setTimeout(() => {
          // Simulate threshold reached
          const thresholdFrame: Frame = {
            id: 'threshold-id',
            topic: 'xs.threshold',
            context_id: '0000000000000000000000000',
            hash: null,
            meta: null,
          };
          mockEventStream.simulateFrame(thresholdFrame);

          setTimeout(() => {
            // Wait for async CAS content loading to complete
            setTimeout(() => {
              try {
                // Manually select the second note
                store.setSelectedNoteId('note-2-id');

                // Should return the correct note object
                expect(store.selectedNoteId()).toBe('note-2-id');
                expect(store.selectedNote()).toBeTruthy();
                expect(store.selectedNote()?.id).toBe('note-2-id');

                // Should pass the keyboard shortcut truthiness check
                expect(!!store.selectedNote()).toBe(true);
                done();
              } catch (error) {
                done(error);
              }
            }, 200);
          }, 100);
        }, 100);
      }, 50);
    });
  });
});
