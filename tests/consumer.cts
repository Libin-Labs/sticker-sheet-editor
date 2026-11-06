import stickers = require('@lp-labs/sticker-sheet-editor');

const input: stickers.StickerSheetInput = {
  width: 80,
  height: 60,
  spacing: 2,
  bleed: 1,
  registrationMargin: 5,
  stickers: [
    { id: 'rect', quantity: 2, width: 10, height: 8, shape: { kind: 'rect' }, color: '#123456' },
  ],
};
console.log(stickers.layoutStickerSheet(input), stickers.renderStickerSheetSvg(input));
