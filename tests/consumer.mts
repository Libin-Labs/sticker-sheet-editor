import {
  layoutStickerSheet,
  renderStickerSheetSvg,
  type StickerSheetInput,
} from '@lp-labs/sticker-sheet-editor';

const sheet: StickerSheetInput = {
  width: 100,
  height: 70,
  spacing: 2,
  bleed: 1,
  registrationMargin: 4,
  stickers: [
    {
      id: 'label',
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
console.log(layoutStickerSheet(sheet), renderStickerSheetSvg(sheet));
