# Requestly: design document

Date: 2026-11-18

## Purpose and rationale

Requestly is a desktop HTTP client (in the spirit of Postman and Insomnia) built with Electron. It aims to be lightweight and fast: it launches with `npm install && npm start`, needs no account, no cloud and no deployment, and keeps everything on the local disk.

Developed on macOS, to be tested later on Windows.

## Goals (v1)

1. **Workspaces (projects):** one workspace per project, each with its own folders, requests and environments.
2. **Sidebar:** project > folders > requests tree. The method is shown in colour (GET green, POST yellow, DELETE red, etc.). Create, rename and delete by hand. **Drag and drop** to move and reorder requests (between folders).
3. **Request editor:** method, URL, query params, headers, JSON body. Params and headers are key/value tables with a checkbox to enable or disable each row.
4. **Response:** status (coloured: 2xx green, 4xx/5xx red), response time, formatted JSON body. No response headers in v1.
5. **Environments:** several per project (e.g. local, prod), key/value variables, selector at the top of the window. `{{variable}}` is replaced on send in the URL, params, headers and body.
6. **Screen layout:** sidebar on the left; in the centre, a bar with method + URL + Send button; below it, the request editor on the left and the response on the right.
7. **Design:** dark, understated theme, inspired by Linear.

## Out of scope (v2 or later)

- **OpenAPI / Swagger import** (2.0 and 3.x, JSON/YAML, by URL or file): creates folders (by tag), prefilled requests, and an environment with `baseUrl`. Planned for v2, after a solid client. Nothing in v1 should prevent it, but it is not built.
- Light theme, tabs for open requests, response headers, history, dedicated authentication (manual headers are enough), automated request tests, sync, accounts.

## Anti-goals (a failure even if it works)

- **Sluggishness.** The worst possible failure.
- **Ugliness.**
- Slow startup, heavy dependencies.

## Constraints

- **Performance first:** few dependencies, no large UI library (lightweight hand-written CSS), window shown immediately, fast JSON display even for a large response.
- Stack: **Electron + React + TypeScript**, with **TypeScript 7** (native compiler, `tsc` command) for type checking if the tooling accepts it.
- Works on macOS and Windows.
- Launch: `npm install && npm start`.
- Local-only projects.

## Decisions

- Electron, React, TypeScript.
- Dark theme, Linear-like.
- Layout B: request on the left, response on the right.
- Response: status, JSON, time.
- Drag and drop of requests in the sidebar.
- Environments in v1.
- OpenAPI import after v1.
- Creating requests by hand always remains possible; import is never required.

## Implementation choices

- **Vite** for bundling the renderer.
- **Storage:** a workspace is a folder on disk with readable JSON files. No database. Advantage: versionable with git, simple to run.
- HTTP requests are sent from Electron's **main process** (not from the browser page) to avoid CORS blocking.
- If TypeScript 7 causes trouble with a tool, use it only for `tsc --noEmit`; Vite compiles on its own.

## Project location

The user picks the folder when creating or opening a project (system dialog). The app remembers the list of recently opened projects and reopens the last one at launch. First launch with no project: an empty screen with "Create project" and "Open project". Files are visible and versionable with git.

## Additional details

- Methods: all standard HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS). Body: JSON or plain text, or none. No form-data in v1.
- Folders: a single level (project > folders > requests). Order is stored in an index file per workspace.
- Undefined `{{x}}` variable, or no environment selected: the text stays as is and a discreet warning is shown before sending. No nested variables. A project may have no environment.
- Non-JSON response (HTML, text): shown as plain text. Network error, invalid URL or timeout: a clear error message replaces the response. 30 s timeout, redirects followed, Cancel button while sending.
- Large response: beyond about 5 MB, the display is truncated with a message.
- Autosave (after a short typing pause). No Save button, no loss when switching requests.
- Request and folder names are turned into file names that are safe on macOS and Windows.
- TypeScript 7: best-effort, with the fallback described above.

## Left to the implementation

Repository folder structure, choice of the drag-and-drop approach (as light as possible) and of the JSON display component, exact format of the JSON files, keyboard shortcuts, icon, README, architecture documentation.
