import {
  For,
  Show,
  createEffect,
  createSignal,
  onMount,
  onCleanup,
} from 'solid-js';
import { createYakStore } from './store';
import type { Note } from './store';
import { Editor } from './components/Editor';
import './App.css';

function App() {
  const store = createYakStore();

  // Subscribe to events on mount
  onMount(() => {
    store.subscribe();
  });

  // Debug the store state
  createEffect(() => {
    console.log('=== Store State Debug ===');
    console.log('Current yak ID:', store.currentYakId());
    console.log('Current yak:', store.currentYak());
    console.log('All yaks:', store.yaks());
    console.log('Current notes:', store.currentNotes());
    console.log('========================');
  });

  // Editor state
  const [isEditorOpen, setIsEditorOpen] = createSignal(false);
  const [editorContent, setEditorContent] = createSignal('');
  const [editingNoteId, setEditingNoteId] = createSignal<string | null>(null);

  // Effect to auto-select first note when currentYak changes
  createEffect(() => {
    const notes = store.currentNotes();
    if (notes.length > 0 && !store.selectedNoteId()) {
      store.setSelectedNoteId(notes[0].id);
    }
  });

  // Keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) {
      switch (e.key) {
        case 'n':
          e.preventDefault();
          openNewNoteEditor();
          break;
        case 'Enter':
          if (store.selectedNote() && !isEditorOpen()) {
            e.preventDefault();
            openEditNoteEditor();
          }
          break;
      }
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  const handleNoteClick = (note: Note) => {
    store.setSelectedNoteId(note.id);
    // Scroll to the note in preview
    scrollToNote(note.id);
  };

  // Scroll to note function
  const scrollToNote = (noteId: string) => {
    setTimeout(() => {
      const noteElement = document.getElementById(`note-${noteId}`);
      if (noteElement) {
        noteElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    }, 100); // Small delay to ensure DOM is updated
  };

  // Editor functions
  const openNewNoteEditor = () => {
    setEditingNoteId(null);
    setEditorContent('');
    setIsEditorOpen(true);
  };

  const openEditNoteEditor = () => {
    const selectedNote = store.selectedNote();
    if (selectedNote) {
      setEditingNoteId(selectedNote.id);
      setEditorContent(selectedNote.content);
      setIsEditorOpen(true);
    }
  };

  const handleEditorSave = async (content: string) => {
    console.log('handleEditorSave called with content:', content);
    console.log('Current yak ID:', store.currentYakId());
    console.log('Editing note ID:', editingNoteId());

    if (!content.trim()) {
      console.log('Content is empty, closing editor');
      setIsEditorOpen(false);
      return;
    }

    try {
      const noteId = editingNoteId();
      if (noteId) {
        // Editing existing note
        console.log('Editing existing note:', noteId);
        await store.editNote(noteId, content);
      } else {
        // Creating new note
        console.log('Creating new note');
        await store.createNote(content);
      }

      setIsEditorOpen(false);
      setEditingNoteId(null);
      setEditorContent('');
      console.log('Note saved successfully');
    } catch (error) {
      console.error('Failed to save note:', error);
      // TODO: Show error to user
    }
  };

  const handleEditorClose = () => {
    setIsEditorOpen(false);
    setEditingNoteId(null);
    setEditorContent('');
  };

  return (
    <div class="app">
      <Show
        when={store.currentNotes() !== undefined}
        fallback={<div class="loading">Loading...</div>}
      >
        <div class="panes">
          {/* Left Pane: Notes List */}
          <div class="notes-list">
            <div class="notes-header">
              <Show when={store.currentYak()}>
                <h2>{store.currentYak()?.name}</h2>
              </Show>
            </div>
            <div class="notes-items">
              <For each={store.currentNotes()!}>
                {note => (
                  <div
                    class={`note-item ${store.selectedNoteId() === note.id ? 'selected' : ''}`}
                    onClick={() => handleNoteClick(note)}
                  >
                    <div class="note-title">{note.title || 'Untitled'}</div>
                    <div class="note-timestamp">
                      {new Date(note.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                )}
              </For>
              <Show when={store.currentNotes()!.length === 0}>
                <div class="empty-state">
                  <p>No notes yet. Press Cmd+N to create your first note.</p>
                </div>
              </Show>
            </div>
          </div>

          {/* Right Pane: Preview */}
          <div class="preview-pane">
            <Show when={store.selectedNote()}>
              <div class="preview-content">
                <For each={store.currentNotes()!}>
                  {note => (
                    <div
                      class={`note-block ${store.selectedNoteId() === note.id ? 'active' : 'faded'}`}
                      id={`note-${note.id}`}
                    >
                      <div class="note-content">
                        {/* For now just render plain text, we'll add markdown later */}
                        <pre>{note.content}</pre>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={!store.selectedNote()}>
              <div class="empty-preview">
                <p>Select a note to preview</p>
              </div>
            </Show>
          </div>
        </div>

        {/* Editor Overlay */}
        <Editor
          isOpen={isEditorOpen()}
          initialContent={editorContent()}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      </Show>
    </div>
  );
}

export default App;
