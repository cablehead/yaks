import { createSignal, onMount, onCleanup, Show, createEffect } from 'solid-js';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

interface EditorProps {
  isOpen: boolean;
  initialContent?: string;
  onClose: () => void;
  onSave: (content: string) => void;
}

export function Editor(props: EditorProps) {
  let editorContainer!: HTMLDivElement;
  let editorView: EditorView | undefined;
  const [isDarkMode, setIsDarkMode] = createSignal(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  onMount(() => {
    // Listen for theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e: MediaQueryListEvent) =>
      setIsDarkMode(e.matches);
    mediaQuery.addEventListener('change', handleThemeChange);

    onCleanup(() => {
      mediaQuery.removeEventListener('change', handleThemeChange);
    });
  });

  // Initialize CodeMirror when editor opens
  const initializeEditor = () => {
    if (!editorContainer || editorView) return;

    console.log('Initializing CodeMirror editor');

    // Custom keymap for cmd+enter to save
    const customKeymap = keymap.of([
      {
        key: 'Cmd-Enter',
        preventDefault: true,
        run: view => {
          const content = view.state.doc.toString();
          console.log('Cmd+Enter pressed, saving:', content);
          props.onSave(content);
          return true;
        },
      },
      {
        key: 'Ctrl-Enter', // For Windows/Linux
        preventDefault: true,
        run: view => {
          const content = view.state.doc.toString();
          console.log('Ctrl+Enter pressed, saving:', content);
          props.onSave(content);
          return true;
        },
      },
      {
        key: 'Escape',
        preventDefault: true,
        run: () => {
          console.log('Escape pressed, closing editor');
          props.onClose();
          return true;
        },
      },
    ]);

    const extensions = [
      customKeymap, // Put keymap first to override defaults
      basicSetup,
      markdown(),
      ...(isDarkMode() ? [oneDark] : []),
    ];

    editorView = new EditorView({
      doc: props.initialContent || '',
      extensions,
      parent: editorContainer,
    });

    // Focus the editor
    setTimeout(() => {
      if (editorView) {
        editorView.focus();
        console.log('Editor focused');
      }
    }, 100);
  };

  // Clean up editor
  const destroyEditor = () => {
    if (editorView) {
      console.log('Destroying editor');
      editorView.destroy();
      editorView = undefined;
    }
  };

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      console.log('Backdrop clicked, closing editor');
      props.onClose();
    }
  };

  // Watch for prop changes with createEffect
  createEffect(() => {
    if (props.isOpen && !editorView) {
      console.log('Editor opened, initializing...');
      setTimeout(() => initializeEditor(), 50);
    } else if (!props.isOpen && editorView) {
      console.log('Editor closed, destroying...');
      destroyEditor();
    }
  });

  onCleanup(() => {
    destroyEditor();
  });

  return (
    <Show when={props.isOpen}>
      <div class="editor-overlay" onClick={handleBackdropClick}>
        <div class="editor-container" onClick={e => e.stopPropagation()}>
          <div class="editor-header">
            <div class="editor-title">Edit Note</div>
            <div class="editor-actions">
              <button
                class="editor-button"
                onClick={() => {
                  const content = editorView?.state.doc.toString() || '';
                  console.log('Save button clicked, content:', content);
                  props.onSave(content);
                }}
              >
                Save
              </button>
              <button
                class="editor-button"
                onClick={() => {
                  console.log('Cancel button clicked');
                  props.onClose();
                }}
              >
                Cancel
              </button>
              <div class="editor-shortcuts">
                <span class="shortcut">⌘⏎ Save</span>
                <span class="shortcut">⎋ Cancel</span>
              </div>
            </div>
          </div>
          <div class="editor-content" ref={editorContainer}></div>
        </div>
      </div>
    </Show>
  );
}
