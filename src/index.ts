export interface StickerPoint {
  readonly x: number;
  readonly y: number;
}

export type StickerShape =
  Readonly<{ kind: 'rect' }> | Readonly<{ kind: 'contour'; points: readonly StickerPoint[] }>;

export interface StickerArtwork {
  readonly id: string;
  readonly quantity: number;
  readonly width: number;
  readonly height: number;
  readonly shape: StickerShape;
  readonly color: string;
}

export interface StickerSheetInput {
  readonly width: number;
  readonly height: number;
  readonly spacing: number;
  readonly bleed: number;
  readonly registrationMargin: number;
  readonly stickers: readonly StickerArtwork[];
}

export interface StickerPlacement {
  readonly id: string;
  readonly sheet: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly cutPath: string;
  readonly bleedPath: string;
}

export interface RegistrationMark {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface StickerSheet {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly placements: readonly StickerPlacement[];
  readonly registrationMarks: readonly RegistrationMark[];
}

export interface UnplacedSticker {
  readonly id: string;
  readonly quantity: number;
  readonly reason: 'too-large' | 'sheet-capacity';
}

export interface StickerSheetDiagnostic {
  readonly code: 'sticker-too-large' | 'sheet-capacity';
  readonly stickerId: string;
  readonly count: number;
  readonly message: string;
}

export interface StickerLayout {
  readonly sheets: readonly StickerSheet[];
  readonly unplaced: readonly UnplacedSticker[];
  readonly diagnostics: readonly StickerSheetDiagnostic[];
}

export interface StickerSheetLimits {
  readonly maxStickers?: number;
  readonly maxContourPoints?: number;
  readonly maxSheets?: number;
}

export class StickerSheetError extends Error {
  constructor(
    readonly code: 'invalid' | 'capacity',
    message: string,
  ) {
    super(message);
    this.name = 'StickerSheetError';
  }
}

const DEFAULT_LIMITS = { maxStickers: 50_000, maxContourPoints: 64, maxSheets: 1_000 };
const MAX_SHEET_EDGE = 10_000;
type DataRecord = Record<string, unknown>;

function record(value: unknown, name: string, fields: readonly string[]): DataRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw new StickerSheetError('invalid', `${name} must be a plain record.`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !fields.includes(key) ||
      !descriptor?.enumerable ||
      !('value' in descriptor)
    )
      throw new StickerSheetError('invalid', `${name} has an unsupported field or accessor.`);
  }
  return value as DataRecord;
}

function array(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new StickerSheetError('invalid', `${name} must be an array.`);
  for (let index = 0; index < value.length; index += 1)
    if (!Object.hasOwn(value, index))
      throw new StickerSheetError('invalid', `${name} cannot have holes.`);
  return value;
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new StickerSheetError('invalid', `${name} must be finite in ${min}..${max}.`);
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value))
    throw new StickerSheetError('invalid', 'Sticker ID must be a safe identifier.');
  return value;
}

function limitsOf(input: StickerSheetLimits): typeof DEFAULT_LIMITS {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(input) as (keyof StickerSheetLimits)[]) {
    const value = input[key];
    const ceiling = DEFAULT_LIMITS[key];
    if (!Number.isSafeInteger(value) || value! < 1 || value! > ceiling)
      throw new StickerSheetError('invalid', `${key} must be an integer in 1..${ceiling}.`);
    limits[key] = value! as never;
  }
  return limits;
}

function readShape(value: unknown, width: number, height: number, maxPoints: number): StickerShape {
  const source = record(value, 'Sticker shape', ['kind', 'points']);
  if (source.kind === 'rect') {
    if (Object.hasOwn(source, 'points'))
      throw new StickerSheetError('invalid', 'Rectangle shapes cannot contain contour points.');
    return Object.freeze({ kind: 'rect' });
  }
  if (source.kind !== 'contour')
    throw new StickerSheetError('invalid', 'Sticker shape kind must be rect or contour.');
  const rawPoints = array(source.points, 'Contour points');
  if (rawPoints.length < 3 || rawPoints.length > maxPoints)
    throw new StickerSheetError('invalid', `Contours require 3..${maxPoints} points.`);
  const points = rawPoints.map((item, index) => {
    const point = record(item, `Contour point ${index}`, ['x', 'y']);
    return Object.freeze({
      x: finite(point.x, `Contour point ${index}.x`, 0, width),
      y: finite(point.y, `Contour point ${index}.y`, 0, height),
    });
  });
  let twiceArea = 0;
  let orientation = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const c = points[(index + 2) % points.length]!;
    if (a.x === b.x && a.y === b.y)
      throw new StickerSheetError('invalid', 'Contour cannot contain adjacent duplicate points.');
    twiceArea += a.x * b.y - b.x * a.y;
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(turn) <= 1e-10)
      throw new StickerSheetError('invalid', 'Contour must have distinct, non-collinear corners.');
    if (orientation === 0) orientation = Math.sign(turn);
    else if (Math.sign(turn) !== orientation)
      throw new StickerSheetError(
        'invalid',
        'Contours must be strictly convex and ordered around the edge.',
      );
  }
  for (let first = 0; first < points.length; first += 1) {
    const a = points[first]!;
    const b = points[(first + 1) % points.length]!;
    for (let second = first + 1; second < points.length; second += 1) {
      if (second === (first + 1) % points.length || (second + 1) % points.length === first)
        continue;
      const c = points[second]!;
      const d = points[(second + 1) % points.length]!;
      const cross = (p: StickerPoint, q: StickerPoint, r: StickerPoint) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)
        throw new StickerSheetError('invalid', 'Contours cannot self-intersect.');
    }
  }
  if (Math.abs(twiceArea) <= 1e-10)
    throw new StickerSheetError('invalid', 'Contour must enclose a positive area.');
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  if (
    Math.min(...xs) !== 0 ||
    Math.min(...ys) !== 0 ||
    Math.max(...xs) !== width ||
    Math.max(...ys) !== height
  )
    throw new StickerSheetError(
      'invalid',
      'Contour bounds must match the sticker width and height.',
    );
  return Object.freeze({ kind: 'contour', points: Object.freeze(points) });
}

function path(points: readonly StickerPoint[], close: boolean): string {
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ')}${close ? ' Z' : ''}`;
}

function offsetConvexPolygon(
  points: readonly StickerPoint[],
  distance: number,
): readonly StickerPoint[] {
  if (distance === 0) return points;
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  const direction = Math.sign(area);
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const length = Math.hypot(dx, dy);
    const normal =
      direction > 0 ? { x: dy / length, y: -dx / length } : { x: -dy / length, y: dx / length };
    return {
      point: { x: point.x + normal.x * distance, y: point.y + normal.y * distance },
      direction: { x: dx, y: dy },
    };
  });
  const output = points.map((_, index) => {
    const previous = edges[(index + edges.length - 1) % edges.length]!;
    const current = edges[index]!;
    const cross =
      previous.direction.x * current.direction.y - previous.direction.y * current.direction.x;
    if (Math.abs(cross) < 1e-10)
      throw new StickerSheetError('invalid', 'Contour bleed offset is numerically unstable.');
    const difference = {
      x: current.point.x - previous.point.x,
      y: current.point.y - previous.point.y,
    };
    const amount =
      (difference.x * current.direction.y - difference.y * current.direction.x) / cross;
    const result = {
      x: previous.point.x + amount * previous.direction.x,
      y: previous.point.y + amount * previous.direction.y,
    };
    if (!Number.isFinite(result.x) || !Number.isFinite(result.y))
      throw new StickerSheetError('capacity', 'Contour bleed bounds exceed numeric range.');
    if (Math.hypot(result.x - points[index]!.x, result.y - points[index]!.y) > distance * 10)
      throw new StickerSheetError(
        'invalid',
        'Contour corner is too acute for the configured bleed.',
      );
    return Object.freeze(result);
  });
  return Object.freeze(output);
}

function normalizedSticker(value: unknown, limits: typeof DEFAULT_LIMITS): StickerArtwork {
  const source = record(value, 'Sticker', ['id', 'quantity', 'width', 'height', 'shape', 'color']);
  const id = identifier(source.id);
  const width = finite(source.width, `${id}.width`, 0.01, MAX_SHEET_EDGE);
  const height = finite(source.height, `${id}.height`, 0.01, MAX_SHEET_EDGE);
  const quantity = finite(source.quantity, `${id}.quantity`, 1, limits.maxStickers);
  if (!Number.isSafeInteger(quantity))
    throw new StickerSheetError('invalid', `Sticker ${id} quantity must be an integer.`);
  if (typeof source.color !== 'string' || !/^#[0-9a-fA-F]{6}$/u.test(source.color))
    throw new StickerSheetError('invalid', `Sticker ${id} color must be a six-digit hex value.`);
  return Object.freeze({
    id,
    quantity,
    width,
    height,
    shape: readShape(source.shape, width, height, limits.maxContourPoints),
    color: source.color.toLowerCase(),
  });
}

export function layoutStickerSheet(
  input: StickerSheetInput,
  options: StickerSheetLimits = {},
): StickerLayout {
  record(input, 'Sticker sheet', [
    'width',
    'height',
    'spacing',
    'bleed',
    'registrationMargin',
    'stickers',
  ]);
  record(options, 'Limits', ['maxStickers', 'maxContourPoints', 'maxSheets']);
  const limits = limitsOf(options);
  const width = finite(input.width, 'Sheet width', 1, MAX_SHEET_EDGE);
  const height = finite(input.height, 'Sheet height', 1, MAX_SHEET_EDGE);
  const spacing = finite(input.spacing, 'Spacing', 0, 100);
  const bleed = finite(input.bleed, 'Bleed', 0, 100);
  const registrationMargin = finite(input.registrationMargin, 'Registration margin', 0, 1_000);
  if (registrationMargin * 2 >= Math.min(width, height))
    throw new StickerSheetError('invalid', 'Registration margin leaves no usable sheet area.');
  const source = array(input.stickers, 'Stickers');
  const stickers = source.map((item) => normalizedSticker(item, limits));
  const ids = new Set<string>();
  let total = 0;
  for (const sticker of stickers) {
    if (ids.has(sticker.id))
      throw new StickerSheetError('invalid', `Duplicate sticker ID ${sticker.id}.`);
    ids.add(sticker.id);
    total += sticker.quantity;
    if (!Number.isSafeInteger(total) || total > limits.maxStickers)
      throw new StickerSheetError('capacity', 'Total sticker quantity exceeds maxStickers.');
  }
  const usableWidth = width - registrationMargin * 2;
  const usableHeight = height - registrationMargin * 2;
  const sheets: { index: number; placements: StickerPlacement[] }[] = [];
  const unplaced: UnplacedSticker[] = [];
  const diagnostics: StickerSheetDiagnostic[] = [];
  let sheetIndex = 0;
  let cursorX = registrationMargin;
  let cursorY = registrationMargin;
  let shelfHeight = 0;
  const newSheet = () => {
    sheetIndex += 1;
    sheets.push({ index: sheetIndex, placements: [] });
    cursorX = registrationMargin;
    cursorY = registrationMargin;
    shelfHeight = 0;
  };
  for (const sticker of stickers) {
    const footprintWidth = sticker.width + 2 * bleed;
    const footprintHeight = sticker.height + 2 * bleed;
    if (footprintWidth > usableWidth || footprintHeight > usableHeight) {
      unplaced.push(
        Object.freeze({ id: sticker.id, quantity: sticker.quantity, reason: 'too-large' }),
      );
      diagnostics.push(
        Object.freeze({
          code: 'sticker-too-large',
          stickerId: sticker.id,
          count: sticker.quantity,
          message: `Sticker ${sticker.id}, including bleed, does not fit the usable sheet area.`,
        }),
      );
      continue;
    }
    for (let copy = 0; copy < sticker.quantity; copy += 1) {
      if (sheetIndex === 0) newSheet();
      if (cursorX > registrationMargin && cursorX + footprintWidth > width - registrationMargin) {
        cursorX = registrationMargin;
        cursorY += shelfHeight + spacing;
        shelfHeight = 0;
      }
      if (cursorY + footprintHeight > height - registrationMargin) {
        if (sheetIndex >= limits.maxSheets) {
          const remaining = sticker.quantity - copy;
          unplaced.push(
            Object.freeze({ id: sticker.id, quantity: remaining, reason: 'sheet-capacity' }),
          );
          diagnostics.push(
            Object.freeze({
              code: 'sheet-capacity',
              stickerId: sticker.id,
              count: remaining,
              message: `Sticker ${sticker.id} has ${remaining} copies that exceed maxSheets.`,
            }),
          );
          break;
        }
        newSheet();
      }
      const x = cursorX + bleed;
      const y = cursorY + bleed;
      const localShape =
        sticker.shape.kind === 'rect'
          ? [
              { x: 0, y: 0 },
              { x: sticker.width, y: 0 },
              { x: sticker.width, y: sticker.height },
              { x: 0, y: sticker.height },
            ]
          : sticker.shape.points;
      const cutPath = path(
        localShape.map((point) => ({ x: point.x + x, y: point.y + y })),
        true,
      );
      const bleedPoints = offsetConvexPolygon(localShape, bleed).map((point) => ({
        x: point.x + x,
        y: point.y + y,
      }));
      const bleedPath = path(bleedPoints, true);
      sheets[sheetIndex - 1]!.placements.push(
        Object.freeze({
          id: sticker.id,
          sheet: sheetIndex,
          x,
          y,
          width: sticker.width,
          height: sticker.height,
          color: sticker.color,
          cutPath,
          bleedPath,
        }),
      );
      cursorX += footprintWidth + spacing;
      shelfHeight = Math.max(shelfHeight, footprintHeight);
    }
  }
  const completedSheets = sheets.map((sheet) =>
    Object.freeze({
      index: sheet.index,
      width,
      height,
      placements: Object.freeze(sheet.placements),
      registrationMarks: Object.freeze(
        registrationMargin === 0
          ? []
          : [
              Object.freeze({
                x: registrationMargin / 2,
                y: registrationMargin / 2,
                radius: Math.min(1, registrationMargin / 4),
              }),
              Object.freeze({
                x: width - registrationMargin / 2,
                y: registrationMargin / 2,
                radius: Math.min(1, registrationMargin / 4),
              }),
              Object.freeze({
                x: width - registrationMargin / 2,
                y: height - registrationMargin / 2,
                radius: Math.min(1, registrationMargin / 4),
              }),
              Object.freeze({
                x: registrationMargin / 2,
                y: height - registrationMargin / 2,
                radius: Math.min(1, registrationMargin / 4),
              }),
            ],
      ),
    }),
  );
  return Object.freeze({
    sheets: Object.freeze(completedSheets),
    unplaced: Object.freeze(unplaced),
    diagnostics: Object.freeze(diagnostics),
  });
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return entities[character]!;
  });
}

export function renderStickerSheetSvg(input: StickerSheetInput, sheetNumber = 1): string {
  const layout = layoutStickerSheet(input);
  if (!Number.isSafeInteger(sheetNumber) || sheetNumber < 1 || sheetNumber > layout.sheets.length)
    throw new StickerSheetError('invalid', 'sheetNumber must identify an existing sheet.');
  const sheet = layout.sheets[sheetNumber - 1]!;
  const stickers = sheet.placements
    .map(
      (placement) =>
        `<g data-sticker="${escapeXml(placement.id)}"><path d="${placement.bleedPath}" fill="${placement.color}" fill-opacity="0.2" stroke="#f97316" stroke-dasharray="0.4 0.4" data-guide="bleed"/><path d="${placement.cutPath}" fill="${placement.color}" stroke="#111827" data-guide="cut"/></g>`,
    )
    .join('');
  const marks = sheet.registrationMarks
    .map(
      (mark) =>
        `<g data-guide="registration"><circle cx="${mark.x}" cy="${mark.y}" r="${mark.radius}" fill="none" stroke="#111827"/><path d="M${mark.x - mark.radius},${mark.y} H${mark.x + mark.radius} M${mark.x},${mark.y - mark.radius} V${mark.y + mark.radius}" stroke="#111827"/></g>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sheet.width} ${sheet.height}" role="img"><rect width="${sheet.width}" height="${sheet.height}" fill="#ffffff"/>${stickers}${marks}</svg>`;
}
