# 3D Asset Editor (Beta)

## 📚 Overview

A local 3D asset editor for creating, modifying, painting, and arranging modular assets — built for the NorthCore development workflow.

The editor provides a lightweight browser-based workspace for building reusable objects without requiring an external backend or cloud service.

Assets and editor data are handled locally and can be stored using JSON.

The app now starts with an editor launcher. Choose **Asset Editor** for the existing 3D tools,
or **Animation Builder** for Raster128 pixel animation and the compatible Legacy1024 editor.
Both use the same desktop/Android app and update infrastructure.
See [Animation Builder migration and validation](docs/animation-builder-migration.md).

---

## ✨ Features

- 🧊 Create and edit common 3D primitives such as cubes, cylinders, spheres, prisms, stairs, and building elements.
- ↔️ Move, rotate, and scale objects directly inside the 3D viewport.
- 🎨 Paint individual object surfaces using a dedicated face-based painting system.
- 🟨 Use the integrated **Apple Cutter** grid system for consistent modular subdivisions and snapping.
- 🧲 Snap objects using the world grid and dedicated form-based snap points.
- 🗂️ Organise objects using the object list and grouping tools.
- 📋 Edit object properties, dimensions, materials, colours, roughness, metallic values, and transparency.
- 🖱️ Multi-select objects using keyboard controls or the selection area.
- 📱 Dedicated touch controls for Android, with the mobile version primarily designed and optimized for tablets.
- 💾 Store project and editor information locally using JSON.
- 🔄 Desktop and Android versions share the same editor and snapping logic.

---

## 📦 Installation

Clone the repository:

```bash
git clone https://github.com/NorthCore-Solutions/NorthCore-3D-Asset-Editor.git
```

Open the project directory and install the dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

The editor can then be opened through the local address shown in the terminal.

---

## 🛠️ Development

The Asset Editor is built using:

- React
- TypeScript
- Vite
- Three.js
- React Three Fiber
- Drei
- Zustand
- Vitest
- Capacitor

The application is designed around a shared codebase for desktop and Android.

---

## 🔒 Privacy & Security

NorthCore Asset Editor is designed as a **local-first application**.

The editor does not require an account and does not depend on a remote backend for normal editing.

Project information and editor data remain on the user's device unless they are explicitly exported, transferred, or published by the user.

No analytics or tracking services are required for the core editor functionality.

---

## 🧩 Apple Cutter System

The integrated Apple Cutter model provides a consistent modular grid for object surfaces.

A base length of `1.0` is divided using a maximum cell size of:

```text
0.25
```

Internal cells remain at `0.25`, while only the symmetrical outer remainder cells may become smaller when an object is scaled.

This system forms the basis for surface subdivisions and form-to-form snapping.

---

## 👤 Author

**NorthCore Solutions**

Developed as part of the NorthCore development environment for creating and preparing reusable 3D assets.

---

## 🚧 Project Status

The Asset Editor is under active development.

Core modelling, painting, object management, Android support, and the Apple Cutter system are implemented, while additional editor and export functionality will continue to be expanded.
