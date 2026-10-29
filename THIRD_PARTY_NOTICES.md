# Third party notices

Content Workbench is licensed under Apache-2.0. Dependencies retain their own licenses and copyright notices.

This inventory includes installed npm production dependencies and the resolved macOS arm64 Rust dependency graph, including Rust build dependencies. It is deliberately broader than the code linked into the application. Optional packages for other targets and npm development tools are not bundled. Their declarations remain in the dependency lockfiles.

See third-party/inventory.json for exact versions and source URLs, and third-party/licenses/ for original license texts. MPL-2.0 components are unmodified; their exact published source archives are included in third-party/sources/. You may obtain, modify and redistribute those components under MPL-2.0. SQLite bundled through libsqlite3-sys is in the public domain; see https://www.sqlite.org/copyright.html.

The application's document icon is generated from assets/icon.svg. Lucide icons retain their upstream ISC license. Electron is a source-level fallback; this Tauri release does not redistribute the Electron runtime.

Packages recorded: 387. Regenerate with npm ci followed by npm run licenses on macOS arm64.
