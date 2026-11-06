# @lp-labs/sticker-sheet-editor

A deterministic, bounded sticker-sheet layout core. It places rectangular and strictly convex
contour stickers, accounts for bleed envelopes and spacing, emits cut/bleed paths and registration
guides, and reports items that cannot be placed.

## Install and quickstart

```sh
npm install @lp-labs/sticker-sheet-editor
```

```js
import assert from 'node:assert/strict';
import { layoutStickerSheet, renderStickerSheetSvg } from '@lp-labs/sticker-sheet-editor';

const input = {
  width: 100,
  height: 70,
  spacing: 2,
  bleed: 1,
  registrationMargin: 4,
  stickers: [
    {
      id: 'badge',
      quantity: 12,
      width: 20,
      height: 10,
      shape: {
        kind: 'contour',
        points: [
          { x: 0, y: 10 },
          { x: 10, y: 0 },
          { x: 20, y: 10 },
        ],
      },
      color: '#336699',
    },
  ],
};
const layout = layoutStickerSheet(input);
assert.ok(layout.sheets[0].placements.length > 0);
console.log(layout.unplaced, renderStickerSheetSvg(input));
```

## API and types

- `layoutStickerSheet(input, limits?)` returns deterministic `sheets`, `unplaced` quantities, and
  actionable diagnostics. Placement is an input-order first-fit shelf algorithm; it does not rotate
  stickers.
- `renderStickerSheetSvg(input, sheetNumber?)` renders the selected one-based sheet with actual cut
  paths, bleed paths, and crosshair registration marks.
- `StickerSheetInput` gives sheet `width`/`height`, minimum rectangle-envelope `spacing`, bleed
  distance on every side of an artwork outline, a reserved `registrationMargin`, and sticker
  designs. `StickerArtwork` has a unique ID, positive integral quantity, positive physical width
  and height, hex color, and either `{ kind: 'rect' }` or
  `{ kind: 'contour', points: [...] }`.
- `StickerPlacement` includes one-based sheet index, physical x/y/width/height, and SVG-ready
  `cutPath`/`bleedPath`. `StickerLayout.unplaced` records exact counts and whether a design is too
  large or exceeded `maxSheets`.
- `StickerSheetLimits` defaults to 50,000 total stickers, 64 contour points, and 1,000 sheets.
  `StickerSheetError.code` is `invalid` or `capacity`.
- Exported model/result types: `StickerPoint`, `StickerShape`, `StickerArtwork`, `StickerSheetInput`,
  `StickerPlacement`, `RegistrationMark`, `StickerSheet`, `UnplacedSticker`,
  `StickerSheetDiagnostic`, `StickerLayout`, and `StickerSheetLimits`.

Contour points are local coordinates in the sticker bounding box, ordered around a strictly convex
polygon whose bounds exactly match the declared width and height. The bleed path uses a bounded
miter offset of that convex outline. Placement spacing is measured between axis-aligned bounding
envelopes of those bleed outlines; it is not an exact polygon-to-polygon minimum distance. Bleed
offsets at extremely acute corners are rejected instead of emitting unstable paths. Empty or sparse
arrays, unsafe colors/IDs, out-of-range values and unsupported fields are rejected.

## Customize, errors, and limits

Supply dimensions in one consistent unit (for example millimeters), set bleed from your print
vendor, and reserve enough registration margin for your press marks. Keep design order stable to
make placement repeatable. Inspect `unplaced` and `diagnostics` before exporting; too-large designs
are not silently scaled. `renderStickerSheetSvg` renders one existing sheet at a time.

Sheet edges are limited to 10,000 units; spacing and bleed are at most 100 units; registration
margin is bounded and must leave a usable area. A sticker plus its bleed must fit within that area.
There are at most 50,000 total requested copies, 64 contour points per sticker, and 1,000 output
sheets by default. `StickerSheetLimits` can lower these caps but not raise them.
First-fit shelf placement is O(total copies); SVG generation is O(placements + contour vertices).
The complete layout is retained in memory, so lower `maxStickers` and `maxSheets` for constrained
devices.

This is not nesting/shape-packing optimization, a cutter-driver, print-production preflight, color
management, sheet calibration, or a guarantee of manufactured bleed/spacing. Registration marks
are simple SVG circles/crosshairs; verify their size and placement with your production equipment.
No external artwork is loaded or interpreted.

## Modules and development

Independent ESM/CommonJS with declarations and zero runtime/peer dependencies. TypeScript
`^5.9.3` and Prettier `^3.6.2` are development-only.

```sh
npm ci --offline
npm run build
npm run typecheck
npm test
npm run format:check
```

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
