# NorthCore 3D Asset Editor

NorthCore 3D Asset Editor is a local-first editing environment for creating reusable 3D assets and native Raster128 pixel animations.

The application combines two dedicated editors in one workspace:

- **3D Asset Editor** for modelling, arranging, painting, and preparing modular 3D assets.
- **Animation Builder** for creating frame-based pixel animations on a native 128×128 raster.

Both editors share the same application shell, local-first workflow, and desktop/Android infrastructure. Normal editing does not require an account, backend, or cloud service.

## Editors

### 3D Asset Editor

The 3D editor provides a compact workspace for building and preparing reusable modular assets.

Key capabilities include:

- Create and edit common 3D primitives such as cubes, cylinders, spheres, prisms, stairs, and building elements.
- Move, rotate, and scale objects directly in the 3D viewport.
- Paint individual object surfaces using the integrated face-based painting system.
- Organise objects with the object list, grouping tools, and editable properties.
- Adjust dimensions, materials, colours, roughness, metallic values, and transparency.
- Use multi-selection and selection-area workflows.
- Snap objects to the world grid and dedicated form-based snap points.
- Use the integrated Apple Cutter grid system for consistent modular subdivisions.

### Animation Builder

The Animation Builder is a native Raster128 editor for frame-based pixel animation.

Key capabilities include:

- Native **128×128** pixel authoring.
- Exact RGBA pixel data without antialiasing in the logical raster.
- Pencil, eraser, eyedropper, selection, move, and transform tools.
- Layer-based editing with visibility and locking.
- Frame-based timeline with per-frame duration and playback.
- Undo and redo.
- Reference images for tracing and positioning.
- Reusable pixel templates.
- Project-folder integration with real filesystem subfolders where supported.
- Local session persistence.
- Raster document import and export.
- PNG export at **1024×1024** using exact nearest-neighbour scaling.

The builder starts with either an empty or transparent Raster128 document.

## Local-first workflow

The application is designed to work locally.

Project and editor data remain on the user's device unless they are explicitly exported, transferred, or published.

Core editing does not require:

- an account
- a remote backend
- a cloud service
- analytics or tracking services

The Animation Builder can additionally connect to a local project folder, allowing `.raster128.json` files to be opened and saved directly inside its directory structure where the platform supports directory access.

## Platforms

The application uses a shared codebase for:

- Windows / desktop
- Android

## Installation

Clone the repository:

```bash
git clone https://github.com/NorthCore-Solutions/NorthCore-3D-Asset-Editor.git
```

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Open the local address shown by Vite in the terminal.

## Technology

The project is built with:

- React
- TypeScript
- Vite
- Three.js
- React Three Fiber
- Drei
- Zustand
- Vitest
- Capacitor

## Apple Cutter system

The 3D editor uses the Apple Cutter model to create consistent modular subdivisions on object surfaces.

A base length of `1.0` is divided using a maximum cell size of:

```text
0.25
```

Internal cells remain at `0.25`. Only symmetrical outer remainder cells may become smaller when an object is scaled.

The system provides the basis for surface subdivisions and form-to-form snapping.

## Architecture documentation

Additional technical documentation is available in:

- [Animation Builder architecture](docs/animation-builder-architecture.md)
- [Animation Builder project-folder and storage model](docs/animation-builder-storage.md)

## Project status

NorthCore 3D Asset Editor is under active development.

The current application includes the established 3D editing workflow and the native Raster128 Animation Builder. Core modelling, painting, object management, local project handling, frame-based pixel animation, references, templates, and export workflows are implemented and continue to be refined.

## Author

**NorthCore Solutions**

Developed as part of the NorthCore development environment for creating and preparing reusable digital assets.
