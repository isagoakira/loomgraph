# Third-party notices

Audit date: 2026-10-02  
Scope: the release artifact produced by `plugins/agent-visual-canvas/scripts/build.mjs`.

The complete package inventory is [`BUNDLED_DEPENDENCIES.md`](BUNDLED_DEPENDENCIES.md).
It contains every exact `name/version` whose installed module contributed
rendered bytes to the checked `server`, `layout`, `ui`, or `tools` artifact.
The standalone collector is [`scripts/collect-third-party-licenses.mjs`](../scripts/collect-third-party-licenses.mjs).
This file keeps the direct-package and font-specific notes below; it is not a
substitute for the complete 138-entry inventory. Development-only tools such
as TypeScript, Vite, Vitest, esbuild, and the React type packages are excluded.

## How the inventory was checked

- Package names and versions were checked against `dist/BUILD_DEPENDENCIES.json`,
  `package.json`, `pnpm-lock.yaml`, and the installed package metadata.
- Production entry points are `src/server/index.ts`, `src/layout/worker.ts`,
  `src/ui/main.tsx`, and the package import/export code under `src/store`.
  `@modelcontextprotocol/client` is declared for host-side/test client use;
  it is not imported by a production entry point and is not included in the
  server or browser bundles.
- The build copies
  `node_modules/@excalidraw/excalidraw/dist/prod/fonts` to
  `dist/ui/excalidraw-assets/fonts`. The checked artifact contains 9 font
  directories and 234 `.woff2` files.
- The files in `licenses/` are the corresponding local license texts. The
  package-level extraction and any upstream-source exceptions are recorded in
  [`BUNDLED_DEPENDENCIES.md`](BUNDLED_DEPENDENCIES.md). Font license texts were
  obtained from the named upstream repositories. The Excalifont text is the
  license metadata embedded in the exact Excalidraw `v0.18.1` font source.

## Direct and special-case packages

| Package and version | SPDX / declared license | Bundle or dependency role | Source | Local license |
| --- | --- | --- | --- | --- |
| `@excalidraw/excalidraw@0.18.1` | `MIT` | Bundled in the browser UI; its production font assets are copied into the browser artifact | [package metadata](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/package.json), [license](https://github.com/excalidraw/excalidraw/blob/v0.18.1/LICENSE) | [`licenses/excalidraw-0.18.1-MIT.txt`](../licenses/excalidraw-0.18.1-MIT.txt) |
| `@modelcontextprotocol/server@2.2.0` | `MIT` in package metadata; the retained `LICENSE` also contains the project's Apache-2.0/CC-BY-4.0 transition notice | Bundled into `dist/server/index.mjs` | [v2.2.0 source](https://github.com/modelcontextprotocol/typescript-sdk/tree/v2.2.0), [license](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.2.0/LICENSE) | [`licenses/modelcontextprotocol-server-2.2.0-MIT.txt`](../licenses/modelcontextprotocol-server-2.2.0-MIT.txt) |
| `@modelcontextprotocol/client@2.2.0` | `MIT` in package metadata; see the composite license text noted above | Declared runtime dependency for host/test client use; not imported by a production build entry point | [v2.2.0 source](https://github.com/modelcontextprotocol/typescript-sdk/tree/v2.2.0), [license](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.2.0/LICENSE) | [`licenses/modelcontextprotocol-client-2.2.0-MIT.txt`](../licenses/modelcontextprotocol-client-2.2.0-MIT.txt) |
| `@modelcontextprotocol/core@2.2.0` | `MIT` in package metadata; see the composite license text noted above | Transitive dependency of the MCP server; bundled through `@modelcontextprotocol/server` | [v2.2.0 source](https://github.com/modelcontextprotocol/typescript-sdk/tree/v2.2.0), [license](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.2.0/LICENSE) | [`licenses/modelcontextprotocol-core-2.2.0-MIT.txt`](../licenses/modelcontextprotocol-core-2.2.0-MIT.txt) |
| `react@19.1.1` | `MIT` | Bundled in the browser UI | [v19.1.1 source](https://github.com/facebook/react/tree/v19.1.1), [license](https://github.com/facebook/react/blob/v19.1.1/LICENSE) | [`licenses/react-19.1.1-MIT.txt`](../licenses/react-19.1.1-MIT.txt) |
| `react-dom@19.1.1` | `MIT` | Bundled in the browser UI | [v19.1.1 source](https://github.com/facebook/react/tree/v19.1.1), [license](https://github.com/facebook/react/blob/v19.1.1/LICENSE) | [`licenses/react-dom-19.1.1-MIT.txt`](../licenses/react-dom-19.1.1-MIT.txt) |
| `elkjs@0.12.0` | `EPL-2.0` selected from the package's `EPL-2.0 OR GPL-3.0-or-later` expression | Bundled in `dist/layout/worker.mjs` for layout candidates | [0.12.0 source](https://github.com/kieler/elkjs/tree/0.12.0), [license](https://github.com/kieler/elkjs/blob/0.12.0/LICENSE.md) | [`licenses/elkjs-0.12.0-EPL-2.0-or-GPL-3.0-or-later.txt`](../licenses/elkjs-0.12.0-EPL-2.0-or-GPL-3.0-or-later.txt) |
| `fflate@0.8.2` | `MIT` | Bundled in the project-package import/export path; also used by the release tooling | [v0.8.2 source](https://github.com/101arrowz/fflate/tree/v0.8.2), [license](https://github.com/101arrowz/fflate/blob/v0.8.2/LICENSE) | [`licenses/fflate-0.8.2-MIT.txt`](../licenses/fflate-0.8.2-MIT.txt) |
| `zod@4.3.6` | `MIT` | Bundled in server validation and shared runtime code | [v4.3.6 source](https://github.com/colinhacks/zod/tree/v4.3.6), [license](https://github.com/colinhacks/zod/blob/v4.3.6/LICENSE) | [`licenses/zod-4.3.6-MIT.txt`](../licenses/zod-4.3.6-MIT.txt) |

## Font assets shipped with the UI

Every path below is relative to
`dist/ui/excalidraw-assets/fonts/`. The hashed names are the files present in
the checked Excalidraw `0.18.1` package. For Google and other upstream font
projects, the upstream repository does not encode a release number in the
Excalidraw package, so the table records the exact Excalidraw asset source and
does not invent an upstream font version.

| Directory / family | Files in the checked artifact | SPDX / license | Source and verification status | Local license |
| --- | --- | --- | --- | --- |
| `Assistant/` | 4: `Assistant-Regular.woff2`, `Assistant-Medium.woff2`, `Assistant-SemiBold.woff2`, `Assistant-Bold.woff2` | `OFL-1.1` | [Exact Excalidraw asset directory](https://github.com/excalidraw/excalidraw/tree/v0.18.1/packages/excalidraw/fonts/Assistant); [upstream font license](https://github.com/google/fonts/blob/main/ofl/assistant/OFL.txt). License verified; upstream font revision is not declared by the SDK. | [`licenses/Assistant-OFL-1.1.txt`](../licenses/Assistant-OFL-1.1.txt) |
| `Cascadia/` | 1: `CascadiaCode-Regular.woff2` | `OFL-1.1` | [Exact Excalidraw asset](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/fonts/Cascadia/CascadiaCode-Regular.woff2); [Microsoft upstream license](https://github.com/microsoft/cascadia-code/blob/main/LICENSE). License verified; exact upstream font revision is not declared by the SDK. | [`licenses/CascadiaCode-OFL-1.1.txt`](../licenses/CascadiaCode-OFL-1.1.txt) |
| `ComicShanns/` | 4: `ComicShanns-Regular-279a7b317d12eb88de06167bd672b4b4.woff2`, `ComicShanns-Regular-6e066e8de2ac57ea9283adb9c24d7f0c.woff2`, `ComicShanns-Regular-dc6a8806fa96795d7b3be5026f989a17.woff2`, `ComicShanns-Regular-fcb0fc02dcbee4c9846b3e2508668039.woff2` | `MIT` | [Exact Excalidraw source and embedded license metadata](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/fonts/ComicShanns/index.ts); [Comic Shanns Mono upstream license](https://github.com/jesusmgg/comic-shanns-mono/blob/master/LICENSE.md). License verified; the subset/derivative revision is not separately versioned. | [`licenses/ComicShannsMono-1.3.0-MIT.txt`](../licenses/ComicShannsMono-1.3.0-MIT.txt) |
| `Excalifont/` | 7: `Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2`, `Excalifont-Regular-3f2c5db56cc93c5a6873b1361d730c16.woff2`, `Excalifont-Regular-41b173a47b57366892116a575a43e2b6.woff2`, `Excalifont-Regular-623ccf21b21ef6b3a0d87738f77eb071.woff2`, `Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2`, `Excalifont-Regular-b9dcf9d2e50a1eaf42fc664b50a3fd0d.woff2`, `Excalifont-Regular-be310b9bcd4f1a43f571c46df7809174.woff2` | `OFL-1.1` | [Exact v0.18.1 source and embedded OFL/copyright metadata](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/fonts/Excalifont/index.ts). The metadata identifies `Copyright (c) 2024 by Excalidraw`, a reserved `Excalifont` name, and version `1.000;Glyphs 3.2 (3227)`. License verified at the exact SDK tag. | [`licenses/Excalifont-OFL-1.1.txt`](../licenses/Excalifont-OFL-1.1.txt) |
| `Liberation/` | 1: `LiberationSans-Regular.woff2` | `OFL-1.1` | [Exact Excalidraw asset](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/fonts/Liberation/LiberationSans-Regular.woff2); [upstream license](https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE). License verified; exact upstream font revision is not declared by the SDK. | [`licenses/LiberationSans-OFL-1.1.txt`](../licenses/LiberationSans-OFL-1.1.txt) |
| `Lilita/` | 2: `Lilita-Regular-i7dPIFZ9Zz-WBtRtedDbYE98RXi4EwSsbg.woff2`, `Lilita-Regular-i7dPIFZ9Zz-WBtRtedDbYEF8RXi4EwQ.woff2` | `OFL-1.1` | [Exact Excalidraw asset directory](https://github.com/excalidraw/excalidraw/tree/v0.18.1/packages/excalidraw/fonts/Lilita); [Google Fonts upstream license](https://github.com/google/fonts/blob/main/ofl/lilitaone/OFL.txt). License verified; upstream font revision is not declared by the SDK. | [`licenses/LilitaOne-OFL-1.1.txt`](../licenses/LilitaOne-OFL-1.1.txt) |
| `Nunito/` | 5: `Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTA3j6zbXWjgevT5.woff2`, `Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTQ3j6zbXWjgeg.woff2`, `Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTk3j6zbXWjgevT5.woff2`, `Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTo3j6zbXWjgevT5.woff2`, `Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTs3j6zbXWjgevT5.woff2` | `OFL-1.1` | [Exact Excalidraw asset directory](https://github.com/excalidraw/excalidraw/tree/v0.18.1/packages/excalidraw/fonts/Nunito); [upstream license](https://github.com/googlefonts/nunito/blob/main/OFL.txt). License verified; upstream font revision is not declared by the SDK. | [`licenses/Nunito-OFL-1.1.txt`](../licenses/Nunito-OFL-1.1.txt) |
| `Virgil/` | 1: `Virgil-Regular.woff2` | `OFL-1.1` | [Exact Excalidraw asset](https://github.com/excalidraw/excalidraw/blob/v0.18.1/packages/excalidraw/fonts/Virgil/Virgil-Regular.woff2); [official Virgil font license](https://github.com/excalidraw/virgil/blob/main/LICENSE.md). License verified; the SDK asset is a processed copy and its upstream font revision is not declared by the package. | [`licenses/Virgil-OFL-1.1.txt`](../licenses/Virgil-OFL-1.1.txt) |
| `Xiaolai/` | 209 files matching `Xiaolai-Regular-<32 hex>.woff2` | `OFL-1.1` | [Exact Excalidraw source snapshot](https://github.com/excalidraw/excalidraw/blob/v0.18.1/scripts/woff2/assets/Xiaolai-Regular.ttf), [integration PR #8530](https://github.com/excalidraw/excalidraw/pull/8530); [upstream Xiaolai license](https://github.com/lxgw/kose-font/blob/master/OFL.txt). License verified. Excalidraw states that this font was adjusted and split for CJK fallback use; the exact upstream release/revision cannot be reconstructed from the SDK package and is intentionally marked unverified. | [`licenses/Xiaolai-OFL-1.1.txt`](../licenses/Xiaolai-OFL-1.1.txt) |

### Font provenance boundary

The Excalidraw package is the precise source for the files shipped here. A
font license being verified does not establish that the package contains the
latest upstream font release. For Assistant, Cascadia, Liberation, Lilita,
Nunito, Virgil, and the Comic Shanns subset, the upstream license is verified
but the upstream asset revision is not encoded in `@excalidraw/excalidraw@0.18.1`.
For Excalifont the exact SDK metadata supplies a font version. Xiaolai is an
explicit Excalidraw-adjusted derivative; only its OFL-1.1 licensing and exact
Excalidraw source snapshot are verified here.
