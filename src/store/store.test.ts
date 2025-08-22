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

  it('should create note with async CAS content loading', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      let effectRuns = 0;

      createEffect(() => {
        const notes = store.notes();
        const noteIds = Object.keys(notes);

        effectRuns++;

        if (effectRuns === 1 && noteIds.length === 0) {
          // First run - no notes yet, create yak then note
          stream.emit({
            id: 'yak-1',
            topic: 'yak.create',
            context_id: '0000000000000000000000000',
            hash: null,
            meta: null,
          });

          stream.emit({
            id: 'note-1',
            topic: 'note.create',
            context_id: '0000000000000000000000000',
            hash: 'content-hash-1',
            meta: { yak_id: 'yak-1' },
          });
        } else if (effectRuns === 2 && noteIds.length === 1) {
          // Note created with placeholder content
          const note = notes['note-1'];
          expect(note).toBeDefined();
          expect(note.id).toBe('note-1');
          expect(note.yakId).toBe('yak-1');
          expect(note.hash).toBe('content-hash-1');
          expect(note.title).toBe('Loading...');
          expect(note.content).toBe('');

          // Check yak's notes array was updated
          expect(store._debug.notesByYak()['yak-1']).toEqual(['note-1']);
        } else if (effectRuns === 3 && noteIds.length === 1) {
          // Content should be loaded now
          const note = notes['note-1'];
          expect(note.content).toBe('content for note-1');
          expect(note.title).toBe('content for note-1'); // first line
          done();
        }
      });
    });
  });

  it('should handle note.create with missing yakId', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      createEffect(() => {
        const notes = store.notes();
        const noteIds = Object.keys(notes);

        // Note should not be created without yakId
        expect(noteIds).toHaveLength(0);
      });

      // Emit note without yakId in meta
      stream.emit({
        id: 'note-1',
        topic: 'note.create',
        context_id: '0000000000000000000000000',
        hash: 'content-hash-1',
        meta: null, // No yakId
      });

      // Give it time to process
      setTimeout(() => {
        expect(Object.keys(store.notes())).toHaveLength(0);
        done();
      }, 10);
    });
  });

  it('should handle CAS content loading errors', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();

      // Override getCasContent to simulate error
      stream.getCasContent = async () => {
        throw new Error('CAS loading failed');
      };

      const store = createYakStore(stream);

      let effectRuns = 0;

      createEffect(() => {
        const notes = store.notes();
        const noteIds = Object.keys(notes);

        effectRuns++;

        if (effectRuns === 1 && noteIds.length === 0) {
          // Create yak then note
          stream.emit({
            id: 'yak-1',
            topic: 'yak.create',
            context_id: '0000000000000000000000000',
            hash: null,
            meta: null,
          });

          stream.emit({
            id: 'note-1',
            topic: 'note.create',
            context_id: '0000000000000000000000000',
            hash: 'failing-hash',
            meta: { yak_id: 'yak-1' },
          });
        } else if (effectRuns === 2 && noteIds.length === 1) {
          // Check initial placeholder content
          const note = notes['note-1'];
          expect(note.content).toBe('');
          expect(note.title).toBe('Loading...');

          // Wait a bit for CAS failure to process
          setTimeout(() => {
            // Trigger another effect by accessing notes again
            const updatedNotes = store.notes();
            const updatedNote = updatedNotes['note-1'];
            expect(updatedNote.content).toBe('Failed to load content');
            expect(updatedNote.title).toBe('Error loading content');
            done();
          }, 20);
        }
      });
    });
  });

  it('should handle note.edit with ID swapping and selection update', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      let effectRuns = 0;

      createEffect(() => {
        const notes = store.notes();
        const noteIds = Object.keys(notes);

        effectRuns++;

        if (effectRuns === 1 && noteIds.length === 0) {
          // Create yak and original note
          stream.emit({
            id: 'yak-1',
            topic: 'yak.create',
            context_id: '0000000000000000000000000',
            hash: null,
            meta: null,
          });

          stream.emit({
            id: 'original-note',
            topic: 'note.create',
            context_id: '0000000000000000000000000',
            hash: 'original-hash',
            meta: { yak_id: 'yak-1' },
          });
        } else if (effectRuns === 2 && noteIds.length === 1) {
          // Original note created, now select it and edit
          store.setSelectedNoteId('original-note');

          // Verify selection was set
          expect(store.selectedNoteId()).toBe('original-note');
          expect(store._debug.notesByYak()['yak-1']).toEqual(['original-note']);

          // Edit the note
          stream.emit({
            id: 'edited-note',
            topic: 'note.edit',
            context_id: '0000000000000000000000000',
            hash: 'edited-hash',
            meta: { yak_id: 'yak-1', note_id: 'original-note' },
          });
        } else if (effectRuns === 3 && noteIds.length === 2) {
          // Both notes should exist temporarily
          expect(notes['original-note']).toBeDefined();
          expect(notes['edited-note']).toBeDefined();

          // New note should have editedNoteId reference
          expect(notes['edited-note'].editedNoteId).toBe('original-note');

          // Selection should be updated to new note
          expect(store.selectedNoteId()).toBe('edited-note');

          // Yak's note list should be updated
          expect(store._debug.notesByYak()['yak-1']).toEqual(['edited-note']);

          done();
        }
      });
    });
  });

  it('should handle note.edit without affecting unrelated selection', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      let effectRuns = 0;

      createEffect(() => {
        const notes = store.notes();
        const noteIds = Object.keys(notes);

        effectRuns++;

        if (effectRuns === 1 && noteIds.length === 0) {
          // Create yak and two notes
          stream.emit({
            id: 'yak-1',
            topic: 'yak.create',
            context_id: '0000000000000000000000000',
            hash: null,
            meta: null,
          });

          stream.emit({
            id: 'note-1',
            topic: 'note.create',
            context_id: '0000000000000000000000000',
            hash: 'hash-1',
            meta: { yak_id: 'yak-1' },
          });

          stream.emit({
            id: 'note-2',
            topic: 'note.create',
            context_id: '0000000000000000000000000',
            hash: 'hash-2',
            meta: { yak_id: 'yak-1' },
          });
        } else if (effectRuns === 3 && noteIds.length === 2) {
          // Both notes created, select note-1 then edit note-2
          store.setSelectedNoteId('note-1');
          expect(store.selectedNoteId()).toBe('note-1');

          // Edit note-2 (not the selected one)
          stream.emit({
            id: 'note-2-edited',
            topic: 'note.edit',
            context_id: '0000000000000000000000000',
            hash: 'hash-2-edited',
            meta: { yak_id: 'yak-1', note_id: 'note-2' },
          });
        } else if (effectRuns === 4 && noteIds.length === 3) {
          // Selection should remain on note-1 (unchanged)
          expect(store.selectedNoteId()).toBe('note-1');

          // Yak's note list should have note-2 replaced with note-2-edited
          const yakNotes = store._debug.notesByYak()['yak-1'];
          expect(yakNotes).toContain('note-1');
          expect(yakNotes).toContain('note-2-edited');
          expect(yakNotes).not.toContain('note-2');

          done();
        }
      });
    });
  });

  it('should handle note.edit with missing yakId or noteId', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      // Create yak and note first
      stream.emit({
        id: 'yak-1',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      });

      stream.emit({
        id: 'note-1',
        topic: 'note.create',
        context_id: '0000000000000000000000000',
        hash: 'hash-1',
        meta: { yak_id: 'yak-1' },
      });

      // Try to edit with missing yakId
      stream.emit({
        id: 'edit-1',
        topic: 'note.edit',
        context_id: '0000000000000000000000000',
        hash: 'edit-hash',
        meta: { note_id: 'note-1' }, // Missing yak_id
      });

      // Try to edit with missing noteId
      stream.emit({
        id: 'edit-2',
        topic: 'note.edit',
        context_id: '0000000000000000000000000',
        hash: 'edit-hash-2',
        meta: { yak_id: 'yak-1' }, // Missing note_id
      });

      setTimeout(() => {
        const notes = store.notes();
        // Should only have the original note, no edit notes created
        expect(Object.keys(notes)).toEqual(['note-1']);
        expect(store._debug.notesByYak()['yak-1']).toEqual(['note-1']);
        done();
      }, 10);
    });
  });

  it('should handle xs.threshold and gate computed values', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      // Before threshold - computed values should be undefined/gated
      expect(store.thresholdReached()).toBe(false);
      expect(store.currentYak()).toBeUndefined();
      expect(store.currentNotes()).toBeUndefined();
      expect(store.selectedNote()).toBeUndefined();

      // Create data before threshold
      stream.emit({
        id: 'yak-1',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      });

      stream.emit({
        id: 'note-1',
        topic: 'note.create',
        context_id: '0000000000000000000000000',
        hash: 'hash-1',
        meta: { yak_id: 'yak-1' },
      });

      store.setSelectedNoteId('note-1');

      // Values should still be gated
      expect(store.currentYak()).toBeUndefined();
      expect(store.currentNotes()).toBeUndefined();
      expect(store.selectedNote()).toBeUndefined();

      // Emit threshold
      stream.emit({
        id: 'threshold-id',
        topic: 'xs.threshold',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      });

      createEffect(() => {
        const thresholdReached = store.thresholdReached();

        if (thresholdReached) {
          // After threshold - computed values should be available
          expect(store.currentYak()).toBeTruthy();
          expect(store.currentYak()!.id).toBe('yak-1');

          expect(store.currentNotes()).toBeTruthy();
          expect(store.currentNotes()!.length).toBe(1);
          expect(store.currentNotes()![0].id).toBe('note-1');

          expect(store.selectedNote()).toBeTruthy();
          expect(store.selectedNote()!.id).toBe('note-1');

          done();
        }
      });
    });
  });

  it('should return null/empty when currentYakId points to non-existent yak', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      // Set current yak to a non-existent ID
      store.setCurrentYakId('non-existent-yak');

      // Emit threshold
      stream.emit({
        id: 'threshold-id',
        topic: 'xs.threshold',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      });

      createEffect(() => {
        const thresholdReached = store.thresholdReached();

        if (thresholdReached) {
          // Should return null/empty when currentYakId points to non-existent yak
          expect(store.currentYak()).toBeNull();
          expect(store.currentNotes()).toEqual([]);
          done();
        }
      });
    });
  });

  it('should call createNote action and append event to stream', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      // Track appendEvent calls
      const appendEventCalls: any[] = [];
      const originalAppendEvent = stream.appendEvent;
      stream.appendEvent = async (request: any) => {
        appendEventCalls.push(request);
        return originalAppendEvent.call(stream, request);
      };

      // Create and set current yak
      stream.emit({
        id: 'yak-1',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      });

      // Call createNote action
      await store.createNote('Test note content');

      // Verify appendEvent was called with correct payload
      expect(appendEventCalls).toHaveLength(1);
      expect(appendEventCalls[0]).toEqual({
        topic: 'note.create',
        content: 'Test note content',
        meta: { yak_id: 'yak-1' },
      });

      done();
    });
  });

  it('should not create note when no current yak exists', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      // Track appendEvent calls
      const appendEventCalls: any[] = [];
      stream.appendEvent = async (request: any) => {
        appendEventCalls.push(request);
        return 'mock-id';
      };

      // Try to create note without any yak
      await store.createNote('Test note content');

      // appendEvent should not be called
      expect(appendEventCalls).toHaveLength(0);

      done();
    });
  });

  it('should call editNote action and append event to stream', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      // Track appendEvent calls
      const appendEventCalls: any[] = [];
      const originalAppendEvent = stream.appendEvent;
      stream.appendEvent = async (request: any) => {
        appendEventCalls.push(request);
        return originalAppendEvent.call(stream, request);
      };

      // Create yak and note
      stream.emit({
        id: 'yak-1',
        topic: 'yak.create',
        context_id: '0000000000000000000000000',
        hash: null,
        meta: null,
      });

      stream.emit({
        id: 'note-1',
        topic: 'note.create',
        context_id: '0000000000000000000000000',
        hash: 'hash-1',
        meta: { yak_id: 'yak-1' },
      });

      // Call editNote action
      await store.editNote('note-1', 'Edited content');

      // Verify appendEvent was called with correct payload
      expect(appendEventCalls).toHaveLength(1);
      expect(appendEventCalls[0]).toEqual({
        topic: 'note.edit',
        content: 'Edited content',
        meta: {
          yak_id: 'yak-1',
          note_id: 'note-1',
        },
      });

      done();
    });
  });

  it('should not edit note when note does not exist', async () => {
    await testEffect(async done => {
      const stream = new MockEventStream();
      const store = createYakStore(stream);

      // Track appendEvent calls
      const appendEventCalls: any[] = [];
      stream.appendEvent = async (request: any) => {
        appendEventCalls.push(request);
        return 'mock-id';
      };

      // Try to edit non-existent note
      await store.editNote('non-existent-note', 'Edited content');

      // appendEvent should not be called
      expect(appendEventCalls).toHaveLength(0);

      done();
    });
  });
});
