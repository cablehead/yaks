# Yak Shaver

Event-sourced note-taking app built with Tauri + SolidJS.

## Development

```bash
npm install
npm run dev     # Run app in development mode
npm run build   # Build complete Tauri app
```

## Quality Assurance

```bash
npm run check   # Run all checks (format + lint + test)
```

### Testing

```bash
npm test               # All tests (frontend + backend)
npm run test:ui        # Frontend tests with UI
npm run test:backend   # Rust tests only
```

### Linting

```bash
npm run lint           # Check all linting (ESLint + Clippy)
npm run lint:ui        # ESLint only
npm run lint:backend   # Clippy only
npm run lint:fix       # Fix all lint issues
```

### Formatting

```bash
npm run fmt            # Check all formatting (Prettier + rustfmt)
npm run fmt:ui         # Prettier check only
npm run fmt:backend    # rustfmt check only
npm run fmt:fix        # Fix all formatting
```
