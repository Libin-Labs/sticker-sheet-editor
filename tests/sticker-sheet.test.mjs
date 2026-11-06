import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutStickerSheet, renderStickerSheetSvg } from '../dist/esm/index.js';

const sheet = () => ({
  width: 100,
  height: 60,
  spacing: 2,
  bleed: 1,
  registrationMargin: 5,
  stickers: [
    { id: 'badge', quantity: 4, width: 20, height: 10, shape: { kind: 'rect' }, color: '#336699' },
  ],
});

test('places every requested rectangle deterministically with bleed-aware spacing', () => {
  const first = layoutStickerSheet(sheet());
  const second = layoutStickerSheet(sheet());
  assert.equal(first.sheets.length, 1);
  assert.equal(first.unplaced.length, 0);
  assert.deepEqual(
    first.sheets[0].placements.map(({ x, y }) => [x, y]),
    [
      [6, 6],
      [30, 6],
      [54, 6],
      [6, 20],
    ],
  );
  assert.deepEqual(first, second);
  assert.equal(first.sheets[0].registrationMarks.length, 4);
});

test('emits actual cut and convex bleed outlines for custom sticker contours', () => {
  const input = {
    width: 60,
    height: 40,
    spacing: 1,
    bleed: 1,
    registrationMargin: 3,
    stickers: [
      {
        id: 'triangle',
        quantity: 1,
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
        color: '#ffcc00',
      },
    ],
  };
  const placement = layoutStickerSheet(input).sheets[0].placements[0];
  assert.ok(placement.cutPath.startsWith('M'));
  assert.ok(placement.cutPath.endsWith('Z'));
  assert.ok(placement.bleedPath.includes('L'));
  assert.notEqual(placement.cutPath, placement.bleedPath);
  const svg = renderStickerSheetSvg(input);
  assert.ok(svg.includes('data-guide="cut"'));
  assert.ok(svg.includes('data-guide="bleed"'));
  assert.ok(svg.includes('data-guide="registration"'));
});

test('reports too-large stickers instead of fabricating placements', () => {
  const result = layoutStickerSheet({
    width: 50,
    height: 30,
    spacing: 1,
    bleed: 2,
    registrationMargin: 5,
    stickers: [
      {
        id: 'large',
        quantity: 2,
        width: 40,
        height: 20,
        shape: { kind: 'rect' },
        color: '#112233',
      },
    ],
  });
  assert.deepEqual(result.unplaced, [{ id: 'large', quantity: 2, reason: 'too-large' }]);
  assert.deepEqual(
    result.diagnostics.map(({ code, count }) => [code, count]),
    [['sticker-too-large', 2]],
  );
  assert.deepEqual(result.sheets, []);
});

test('limits sheet count and reports exact remaining copies', () => {
  const input = {
    width: 20,
    height: 20,
    spacing: 0,
    bleed: 0,
    registrationMargin: 1,
    stickers: [
      { id: 'small', quantity: 10, width: 8, height: 8, shape: { kind: 'rect' }, color: '#112233' },
    ],
  };
  const result = layoutStickerSheet(input, { maxSheets: 2 });
  assert.equal(result.sheets.length, 2);
  assert.equal(
    result.sheets.reduce((total, page) => total + page.placements.length, 0),
    8,
  );
  assert.deepEqual(result.unplaced, [{ id: 'small', quantity: 2, reason: 'sheet-capacity' }]);
  assert.deepEqual(
    result.diagnostics.map((item) => [item.code, item.count]),
    [['sheet-capacity', 2]],
  );
});

test('rejects concave, malformed, self-crossing and mismatched contours', () => {
  const base = {
    width: 50,
    height: 40,
    spacing: 1,
    bleed: 0.5,
    registrationMargin: 2,
    stickers: [{ id: 'shape', quantity: 1, width: 10, height: 10, color: '#123456' }],
  };
  const contour = (points) => ({
    ...base,
    stickers: [{ ...base.stickers[0], shape: { kind: 'contour', points } }],
  });
  assert.throws(
    () =>
      layoutStickerSheet(
        contour([
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 5, y: 4 },
          { x: 0, y: 10 },
        ]),
      ),
    /strictly convex/,
  );
  assert.throws(
    () =>
      layoutStickerSheet(
        contour([
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
          { x: 10, y: 0 },
        ]),
      ),
    /convex|non-collinear/,
  );
  assert.throws(
    () =>
      layoutStickerSheet(
        contour([
          { x: 1, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 1, y: 10 },
        ]),
      ),
    /bounds must match/,
  );
  assert.throws(
    () =>
      layoutStickerSheet(
        contour([
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
      ),
    /3\.\.64/,
  );
  assert.throws(
    () =>
      layoutStickerSheet(
        contour([
          { x: 5, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 4 },
          { x: 10, y: 4 },
          { x: 0, y: 10 },
        ]),
      ),
    /self-intersect/,
  );
});

test('rejects invalid counts, colors, sheet bounds, duplicate IDs and sparse inputs', () => {
  const input = sheet();
  assert.throws(() => layoutStickerSheet({ ...input, width: NaN }), /finite/);
  assert.throws(() => layoutStickerSheet({ ...input, registrationMargin: 30 }), /leaves no usable/);
  assert.throws(
    () => layoutStickerSheet({ ...input, stickers: [{ ...input.stickers[0], quantity: 0 }] }),
    /finite in/,
  );
  assert.throws(
    () => layoutStickerSheet({ ...input, stickers: [{ ...input.stickers[0], color: 'url(x)' }] }),
    /six-digit hex/,
  );
  assert.throws(
    () => layoutStickerSheet({ ...input, stickers: [input.stickers[0], input.stickers[0]] }),
    /Duplicate sticker/,
  );
  assert.throws(() => layoutStickerSheet({ ...input, stickers: new Array(1) }), /holes/);
});

test('checks contour bleed numerics, resource caps and sheet selection', () => {
  const input = {
    width: 100,
    height: 100,
    spacing: 1,
    bleed: 2,
    registrationMargin: 5,
    stickers: [
      { id: 'rect', quantity: 1, width: 10, height: 10, shape: { kind: 'rect' }, color: '#010203' },
    ],
  };
  assert.throws(
    () =>
      layoutStickerSheet(
        { ...input, stickers: [{ ...input.stickers[0], quantity: 2 }] },
        { maxStickers: 1 },
      ),
    /quantity|capacity/,
  );
  assert.throws(() => renderStickerSheetSvg(input, 0), /sheetNumber/);
  assert.throws(
    () =>
      layoutStickerSheet({
        ...input,
        width: 150,
        stickers: [
          {
            id: 'needle',
            quantity: 1,
            width: 100,
            height: 1,
            shape: {
              kind: 'contour',
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 0.001, y: 1 },
              ],
            },
            color: '#010203',
          },
        ],
      }),
    /acute|unstable/,
  );
});
