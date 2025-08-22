import { createStore } from 'solid-js/store';
import {
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  batch,
} from 'solid-js';
import { Scru128Id } from 'scru128';
import type { EventStreamInterface, Frame } from './types';

export interface Note {
  id: string;
  content: string;
  title: string; // First line preview
  yakId: string;
  hash?: string;
  timestamp: string; // From SCRU128 ID
  editedNoteId?: string; // If this is an edit, reference to original
}

export interface Yak {
  id: string;
  name: string; // Human-friendly timestamp
  timestamp: string; // From SCRU128 ID
  lastActivity: string; // Most recent note timestamp
}

interface StoreState {
  yaks: Record<string, Yak>;
  notes: Record<string, Note>;
  notesByYak: Record<string, string[]>; // yakId -> noteIds[]
}

// Extract human-friendly timestamp from SCRU128 ID
function scru128ToTimestamp(id: string): string {
  try {
    const parsed = Scru128Id.fromString(id);
    return new Date(parsed.timestamp).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function scru128ToHumanTime(id: string): string {
  try {
    const parsed = Scru128Id.fromString(id);
    const date = new Date(parsed.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}:${minute}`;
  } catch {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}-${hour}:${minute}`;
  }
}

function getFirstLine(content: string): string {
  return content.split('\n')[0].substring(0, 80); // First line, max 80 chars
}

export function createYakStore(eventStream?: EventStreamInterface) {
  // Lazy import so tests aren't polluted
  const stream =
    eventStream ??
    (() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
      const { TauriEventStream } = require('./tauri');
      return new TauriEventStream();
    })();
  const [state, setState] = createStore<StoreState>({
    yaks: {},
    notes: {},
    notesByYak: {},
  });

  const [currentYakId, setCurrentYakId] = createSignal<string>('');
  const [selectedNoteId, setSelectedNoteId] = createSignal<string>('');
  const [thresholdReached, setThresholdReached] = createSignal(false);
  const [currentFrame, setCurrentFrame] = createSignal<Frame | null>(null);

  // Set up event stream listener to feed frames into signal
  let cleanup: (() => void) | null = null;
  cleanup = stream.onFrame(frame => {
    setCurrentFrame(frame);
  });

  onCleanup(() => {
    cleanup?.();
  });

  // Process frames using createEffect for proper reactivity
  createEffect(() => {
    const frame = currentFrame();
    if (!frame) return;

    processFrame(frame);
  });

  function processFrame(frame: Frame) {
    // Handle threshold frame to signal end of historical replay
    if (frame.topic === 'xs.threshold') {
      setThresholdReached(true);
      return;
    }

    if (frame.topic === 'yak.create') {
      const yak: Yak = {
        id: frame.id,
        name: scru128ToHumanTime(frame.id),
        timestamp: scru128ToTimestamp(frame.id),
        lastActivity: scru128ToTimestamp(frame.id),
      };

      setState('yaks', frame.id, yak);
      setState('notesByYak', frame.id, []);

      // Set as current yak if it's the first one
      if (currentYakId() === '') {
        setCurrentYakId(frame.id);
      }
    } else if (frame.topic === 'note.create') {
      const yakId = frame.meta?.yak_id;
      if (!yakId) return;

      // Create note immediately with placeholder content
      const note: Note = {
        id: frame.id,
        content: '', // Will be loaded asynchronously
        title: 'Loading...',
        yakId,
        hash: frame.hash,
        timestamp: scru128ToTimestamp(frame.id),
      };

      batch(() => {
        setState('notes', frame.id, note);
        setState('notesByYak', yakId, notes => [...notes, frame.id]);

        // Update yak's last activity
        setState('yaks', yakId, 'lastActivity', scru128ToTimestamp(frame.id));
      });

      // Load content asynchronously if hash is provided
      if (frame.hash) {
        stream
          .getCasContent(frame.hash)
          .then(content => {
            batch(() => {
              setState('notes', frame.id, 'content', content);
              setState('notes', frame.id, 'title', getFirstLine(content));
            });
          })
          .catch(error => {
            console.error('Failed to get CAS content:', error);
            batch(() => {
              setState('notes', frame.id, 'content', 'Failed to load content');
              setState('notes', frame.id, 'title', 'Error loading content');
            });
          });
      }
    } else if (frame.topic === 'note.edit') {
      const yakId = frame.meta?.yak_id;
      const originalNoteId = frame.meta?.note_id;
      if (!yakId || !originalNoteId) return;

      // Capture current selectedNoteId before state changes
      const currentSelectedId = selectedNoteId();

      // Create edited note immediately with placeholder content
      const note: Note = {
        id: frame.id,
        content: '', // Will be loaded asynchronously
        title: 'Loading...',
        yakId,
        hash: frame.hash,
        timestamp: scru128ToTimestamp(frame.id),
        editedNoteId: originalNoteId,
      };

      batch(() => {
        setState('notes', frame.id, note);

        // Replace the old note ID with the new one in the yak's notes list
        setState('notesByYak', yakId, notes =>
          notes.map(id => (id === originalNoteId ? frame.id : id))
        );

        // Update selectedNoteId if it was pointing to the old note
        if (currentSelectedId === originalNoteId) {
          setSelectedNoteId(frame.id);
        }

        // Update yak's last activity
        setState('yaks', yakId, 'lastActivity', scru128ToTimestamp(frame.id));
      });

      // Load content asynchronously if hash is provided
      if (frame.hash) {
        stream
          .getCasContent(frame.hash)
          .then(content => {
            batch(() => {
              setState('notes', frame.id, 'content', content);
              setState('notes', frame.id, 'title', getFirstLine(content));
            });
          })
          .catch(error => {
            console.error('Failed to get CAS content:', error);
            batch(() => {
              setState('notes', frame.id, 'content', 'Failed to load content');
              setState('notes', frame.id, 'title', 'Error loading content');
            });
          });
      }
    }
  }

  // Computed values - gated by threshold to prevent UI updates during replay
  const currentYak = createMemo(() => {
    if (!thresholdReached()) return undefined;
    const id = currentYakId();
    return id ? state.yaks[id] || null : null;
  });

  const currentNotes = createMemo(() => {
    if (!thresholdReached()) return undefined;
    const yakId = currentYakId();
    if (!yakId) return [];

    const noteIds = state.notesByYak[yakId] || [];
    return noteIds.map(id => state.notes[id]).filter(Boolean);
  });

  const selectedNote = createMemo(() => {
    if (!thresholdReached()) return undefined;
    const id = selectedNoteId();
    return id ? state.notes[id] || null : null;
  });

  // Actions
  async function createNote(content: string) {
    const yakId = currentYakId();
    console.log('createNote called, yakId:', yakId, 'content:', content);

    if (!yakId) {
      console.error('No current yak ID! Cannot create note.');
      return;
    }

    console.log('Calling stream.appendEvent...');
    await stream.appendEvent({
      topic: 'note.create',
      content,
      meta: { yak_id: yakId },
    });
    console.log('appendEvent completed');
  }

  async function editNote(noteId: string, content: string) {
    const note = state.notes[noteId];
    if (!note) return;

    await stream.appendEvent({
      topic: 'note.edit',
      content,
      meta: {
        yak_id: note.yakId,
        note_id: noteId,
      },
    });
  }

  // Subscribe function to initiate event stream
  async function subscribe() {
    try {
      await stream.subscribeToEvents();
      console.log('Successfully subscribed to events');
    } catch (error) {
      console.error('Failed to subscribe to events:', error);
    }
  }

  return {
    // State
    yaks: () => state.yaks,
    notes: () => state.notes,
    currentYak,
    currentNotes,
    selectedNote,
    currentYakId,
    selectedNoteId,
    thresholdReached,

    // Actions
    setCurrentYakId,
    setSelectedNoteId,
    createNote,
    editNote,
    subscribe,

    // Raw event stream for debugging
    stream,

    // Debug access to internal state
    _debug: {
      notesByYak: () => state.notesByYak,
    },
  };
}
