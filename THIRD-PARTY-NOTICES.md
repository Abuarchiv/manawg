# Third-party notices

ManaWG itself is licensed under the [Apache License 2.0](LICENSE). The components below are
included in the source or served by the app under their own licences. Dependencies installed by
pnpm keep their own licence files in their packages. Copies of the texts named here are in
[apps/web/public/licenses/](apps/web/public/licenses/), so they ship with every build and Docker
image.

## Fonts

Inter, Inter Tight and JetBrains Mono are licensed under the SIL Open Font License 1.1. The Latin
subsets are in [apps/web/src/shared/fonts/](apps/web/src/shared/fonts/).

| Font | Copyright | Licence text |
| --- | --- | --- |
| Inter | Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter) | [Inter-OFL.txt](apps/web/public/licenses/Inter-OFL.txt) |
| Inter Tight | Copyright 2022 The Inter Project Authors (https://github.com/rsms/inter-tight) | [Inter-Tight-OFL.txt](apps/web/public/licenses/Inter-Tight-OFL.txt) |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | [JetBrains-Mono-OFL.txt](apps/web/public/licenses/JetBrains-Mono-OFL.txt) |

## shadcn/ui

The components in [apps/web/src/components/ui/](apps/web/src/components/ui/) and
[apps/web/src/shared/shadcn.css](apps/web/src/shared/shadcn.css) derive from
[shadcn/ui](https://github.com/shadcn-ui/ui), licensed under the MIT License, Copyright (c) 2023
shadcn. The licence text is in [MIT-shadcn-ui.txt](apps/web/public/licenses/MIT-shadcn-ui.txt).

```text
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Text recognition (OCR)

The expense import reads screenshots in the browser. The worker, the WebAssembly core and the
German and English models are served by the app from `/tesseract/`. They are copied from the
installed packages at build time and are not committed. All three are licensed under the Apache
License 2.0, whose text is in [Apache-2.0.txt](apps/web/public/licenses/Apache-2.0.txt). The
worker also bundles small MIT and BSD libraries, listed in `/tesseract/worker.min.js.LICENSE.txt`.

- [tesseract.js](https://github.com/naptha/tesseract.js), the worker.
- [tesseract.js-core](https://github.com/naptha/tesseract.js-core), the WebAssembly build of
  Tesseract.
- The `deu` and `eng` models from [tessdata_best](https://github.com/tesseract-ocr/tessdata_best),
  packaged as `@tesseract.js-data/deu` and `@tesseract.js-data/eng`.

The licence files of the first two and a README naming the sources are placed next to the served
files in `/tesseract/`.
