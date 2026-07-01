# RefFlow Studio

RefFlow Studio is a Windows desktop reference-board app for artists, designers, and developers. It provides a floating always-on-top workspace for images, PDFs, notes, sketches, local boards, and visual search.

## Features

- Floating pill control panel for quick actions.
- Draggable image and PDF reference windows.
- Notes and sketch pads for board annotations.
- Project manager for multiple local boards.
- Local board export and autosave folder support.
- Native Windows installer built with Electron Builder.

## Planned Later

These features were intentionally removed from the current release UI because they need a more reliable implementation:

- Copy/paste references into external apps.
- Drag references from RefFlow Studio into external apps.
- Auto high-resolution replacement.

## Requirements

- Windows 10 or later for the packaged app.
- Node.js 20 or later for development.

## Development

Install dependencies:

```bash
npm install
```

Run the Vite development server:

```bash
npm run dev
```

Run the Electron app in development mode:

```bash
npm run electron:dev
```

Type-check the project:

```bash
npm run lint
```

Build the frontend:

```bash
npm run build
```

Build the Windows installer:

```bash
npm run electron:dist
```

The installer is written to `dist_desktop/`.

## Release Notes

- Build artifacts such as `dist/`, `dist_desktop/`, `.exe`, and `.blockmap` files are ignored by Git.
- The installer uses `assets/referenceflow.ico` for installer, uninstaller, and app executable branding.
- The app executable runs as the current user so normal desktop interactions are not blocked by Windows elevation rules.

## License

MIT
