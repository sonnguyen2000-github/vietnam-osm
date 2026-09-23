import { polygon, multiPolygon, featureCollection } from '@turf/helpers';
import * as turfAreaMod from '@turf/area';
import * as turfIntersectMod from '@turf/intersect';
import * as turfKinksMod from '@turf/kinks';
import { BoundingBox, OSMPlace, SelectedBuildingPlace } from './types';

// Robust function resolver across ESM, CommonJS, and esbuild bundles
function resolveTurfFn<T extends (...args: any[]) => any>(mod: any, name: string): T {
  if (typeof mod[name] === 'function') return mod[name];
  if (typeof mod.default === 'function') return mod.default;
  if (mod.default && typeof mod.default[name] === 'function') return mod.default[name];
  if (mod.default && typeof mod.default.default === 'function') return mod.default.default;
  if (typeof mod === 'function') return mod;
  throw new Error(`Cannot resolve function ${name} from module`);
}

const calculateArea = resolveTurfFn<(geojson: any) => number>(turfAreaMod, 'area');
const computeIntersect = resolveTurfFn<(fc: any) => any>(turfIntersectMod, 'intersect');
const computeKinks = resolveTurfFn<(poly: any) => any>(turfKinksMod, 'kinks');

export const MAX_SELECTION_VERTICES = 1000;
export const MAX_SELECTION_AREA_M2 = 25 * 1000 * 1000; // 25 km2
export const MAX_SELECTION_BBOX_SPAN_DEG = 0.15; // ~16.5 km
export const DEFAULT_CANDIDATE_LIMIT = 3000;
export const SELECTION_COVERAGE_THRESHOLD = 0.5;

export interface ValidationSuccess {
  valid: true;
  ring: [number, number][];
  bbox: BoundingBox;
  areaM2: number;
}

export interface ValidationFailure {
  valid: false;
  statusCode: 400 | 422;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Computes the 2D planar Shoelace area of a ring in degrees.
 * If all vertices are collinear, this will return 0 (or close to 0 within float epsilon).
 */
export function computeShoelaceArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum) / 2;
}

/**
 * Validates and normalizes selection coordinates from client request body.
 *
 * Rules:
 * - Must be an array of at least 3 distinct vertices.
 * - Each vertex must be a 2-element array [lon, lat] of finite numbers (no string coercion).
 * - Bounds: -180 <= lon <= 180, -90 <= lat <= 90.
 * - No antimeridian crossing in v1.
 * - Deduplicates consecutive duplicate points before closing ring.
 * - Automatically closes ring by appending first vertex if not closed.
 * - Must not be collinear (planar area > 0) and must have positive geodesic area.
 * - Must not self-intersect (checked via @turf/kinks).
 * - Must be within vertex and area/bbox limits.
 */
export function validateAndNormalizeSelectionPolygon(inputCoordinates: unknown): ValidationResult {
  if (!Array.isArray(inputCoordinates)) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Vui lòng cung cấp toạ độ vùng chọn qua mảng `coordinates` dạng [[lon, lat], ...].',
    };
  }

  if (inputCoordinates.length > MAX_SELECTION_VERTICES) {
    return {
      valid: false,
      statusCode: 422,
      error: `Vùng chọn vượt quá số đỉnh tối đa cho phép (${MAX_SELECTION_VERTICES} đỉnh).`,
    };
  }

  if (inputCoordinates.length < 3) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Vùng chọn phải có ít nhất 3 đỉnh phân biệt để tạo thành một đa giác.',
    };
  }

  // Validate types and ranges
  const rawPoints: [number, number][] = [];
  for (let i = 0; i < inputCoordinates.length; i++) {
    const pt = inputCoordinates[i];
    if (!Array.isArray(pt) || pt.length !== 2) {
      return {
        valid: false,
        statusCode: 400,
        error: `Đỉnh thứ ${i + 1} không hợp lệ: mỗi đỉnh phải là mảng gồm 2 phần tử [kinh độ, vĩ độ].`,
      };
    }

    const [lon, lat] = pt;
    if (typeof lon !== 'number' || typeof lat !== 'number') {
      return {
        valid: false,
        statusCode: 400,
        error: `Toạ độ tại đỉnh thứ ${i + 1} phải là kiểu số (number), không chấp nhận chuỗi hoặc giá trị khác.`,
      };
    }

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return {
        valid: false,
        statusCode: 400,
        error: `Toạ độ tại đỉnh thứ ${i + 1} không hợp lệ (NaN hoặc vô hạn).`,
      };
    }

    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return {
        valid: false,
        statusCode: 400,
        error: `Toạ độ tại đỉnh thứ ${i + 1} nằm ngoài giới hạn hợp lệ (-180 <= lon <= 180, -90 <= lat <= 90).`,
      };
    }

    rawPoints.push([lon, lat]);
  }

  // Check antimeridian crossing
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (let i = 0; i < rawPoints.length; i++) {
    const [lon, lat] = rawPoints[i];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;

    if (i > 0) {
      const prevLon = rawPoints[i - 1][0];
      if (Math.abs(lon - prevLon) > 180) {
        return {
          valid: false,
          statusCode: 400,
          error: 'Bản đầu chưa hỗ trợ vùng chọn vượt kinh tuyến đổi ngày (antimeridian).',
        };
      }
    }
  }

  if (maxLon - minLon > 180) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Bản đầu chưa hỗ trợ vùng chọn vượt kinh tuyến đổi ngày (antimeridian).',
    };
  }

  // Deduplicate consecutive identical points
  const deduplicated: [number, number][] = [];
  for (const pt of rawPoints) {
    if (deduplicated.length === 0) {
      deduplicated.push(pt);
    } else {
      const prev = deduplicated[deduplicated.length - 1];
      if (prev[0] !== pt[0] || prev[1] !== pt[1]) {
        deduplicated.push(pt);
      }
    }
  }

  // Count distinct points before auto-closing ring
  let distinctCount = deduplicated.length;
  if (
    deduplicated.length >= 2 &&
    deduplicated[0][0] === deduplicated[deduplicated.length - 1][0] &&
    deduplicated[0][1] === deduplicated[deduplicated.length - 1][1]
  ) {
    distinctCount = deduplicated.length - 1;
  }

  if (distinctCount < 3) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Vùng chọn phải có ít nhất 3 đỉnh phân biệt để tạo thành một đa giác.',
    };
  }

  // Ensure ring is closed
  const ring: [number, number][] = [...deduplicated];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }

  // Validate geometry with Turf
  let turfPoly;
  try {
    turfPoly = polygon([ring]);
  } catch (err: any) {
    return {
      valid: false,
      statusCode: 400,
      error: `Đường bao vùng chọn không tạo thành đa giác hợp lệ: ${err?.message || 'Lỗi hình học'}`,
    };
  }

  // Check self-intersection (kinks)
  try {
    const selfIntersections = computeKinks(turfPoly);
    if (selfIntersections.features.length > 0) {
      return {
        valid: false,
        statusCode: 400,
        error: 'Đường bao vùng chọn tự cắt chính nó (self-intersecting polygon).',
      };
    }
  } catch (err: any) {
    return {
      valid: false,
      statusCode: 400,
      error: `Kiểm tra tự cắt thất bại: ${err?.message || 'Lỗi hình học'}`,
    };
  }

  // Check 2D planar Shoelace area (detects collinear points)
  const shoelace = computeShoelaceArea(ring);
  if (shoelace < 1e-12) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Các đỉnh của vùng chọn thẳng hàng hoặc diện tích phẳng bằng 0.',
    };
  }

  // Check geodesic area
  let areaM2 = 0;
  try {
    areaM2 = calculateArea(turfPoly);
  } catch (err: any) {
    return {
      valid: false,
      statusCode: 400,
      error: `Tính diện tích vùng chọn thất bại: ${err?.message || 'Lỗi hình học'}`,
    };
  }

  if (areaM2 <= 0.01) {
    return {
      valid: false,
      statusCode: 400,
      error: 'Diện tích vùng chọn bằng 0 hoặc không hợp lệ.',
    };
  }

  // Check size/span limits
  const lonSpan = maxLon - minLon;
  const latSpan = maxLat - minLat;
  if (
    areaM2 > MAX_SELECTION_AREA_M2 ||
    lonSpan > MAX_SELECTION_BBOX_SPAN_DEG ||
    latSpan > MAX_SELECTION_BBOX_SPAN_DEG
  ) {
    return {
      valid: false,
      statusCode: 422,
      error: `Vùng chọn vượt quá giới hạn xử lý tối đa (tối đa 25 km² hoặc kích thước tối đa 0.15 độ). Vui lòng thu nhỏ vùng chọn.`,
    };
  }

  const bbox: BoundingBox = {
    minLon,
    minLat,
    maxLon,
    maxLat,
  };

  return {
    valid: true,
    ring,
    bbox,
    areaM2,
  };
}

interface BuildingCandidateScore {
  place: OSMPlace;
  coverageRatio: number;
  intersectionArea: number;
}

/**
 * Calculates building selection based on coverage ratio:
 * coverageRatio = area(intersection(selection, building)) / area(building)
 *
 * Rules:
 * - Only places with coverageRatio >= SELECTION_COVERAGE_THRESHOLD (0.5) are returned.
 * - Touching edges/vertices produce intersection area = 0 and are excluded.
 * - Original OSMPlace geometry is preserved.
 * - Results are sorted:
 *   1. coverageRatio descending
 *   2. intersectionArea descending
 *   3. id ascending
 * - No duplicate IDs.
 */
export function calculateBuildingSelection(
  selectionRing: [number, number][],
  candidatePlaces: OSMPlace[],
  threshold = SELECTION_COVERAGE_THRESHOLD
): SelectedBuildingPlace[] {
  const selectionPoly = polygon([selectionRing]);
  const scoredBuildings: BuildingCandidateScore[] = [];
  const seenIds = new Set<string>();

  for (const place of candidatePlaces) {
    if (!place || !place.geometry || !place.geometryType) continue;
    if (seenIds.has(place.id)) continue;

    // Only process Polygon or MultiPolygon buildings
    if (place.geometryType !== 'Polygon' && place.geometryType !== 'MultiPolygon') {
      continue;
    }

    let buildingFeature;
    try {
      if (place.geometryType === 'Polygon') {
        const coords = (place.geometry as { coordinates: number[][][] }).coordinates;
        if (!coords || coords.length === 0 || !coords[0] || coords[0].length < 3) continue;
        buildingFeature = polygon(coords);
      } else {
        const coords = (place.geometry as { coordinates: number[][][][] }).coordinates;
        if (!coords || coords.length === 0) continue;
        buildingFeature = multiPolygon(coords);
      }
    } catch {
      // Skip places with unparseable GeoJSON geometry
      continue;
    }

    // 1. Calculate building area (denominator)
    let buildingArea = 0;
    try {
      buildingArea = calculateArea(buildingFeature);
    } catch {
      continue;
    }

    if (buildingArea <= 0) continue;

    // 2. Calculate intersection with selection polygon
    let interFeature;
    try {
      const fc = featureCollection<any>([selectionPoly, buildingFeature]);
      interFeature = computeIntersect(fc);
    } catch {
      // Clipping failure on corrupt geometry
      continue;
    }

    if (!interFeature) {
      continue;
    }

    // 3. Calculate intersection area (numerator)
    let interArea = 0;
    try {
      interArea = calculateArea(interFeature);
    } catch {
      continue;
    }

    if (interArea <= 0) {
      continue;
    }

    // 4. Compute coverage ratio
    const rawRatio = interArea / buildingArea;
    // Handle small float precision error on boundary (e.g. 0.4999999999968 instead of 0.5)
    // 1e-7 is small enough that 49.9% (0.499) is strictly rejected, while true 50% floating inaccuracy is preserved.
    const FLOAT_EPSILON = 1e-7;
    let effectiveRatio = rawRatio;
    if (Math.abs(effectiveRatio - threshold) < FLOAT_EPSILON) {
      effectiveRatio = threshold;
    }
    // Clamp minor floating point inaccuracies to [0, 1]
    const clampedRatio = Math.min(1, Math.max(0, effectiveRatio));

    // Threshold check (must be >= 0.5 without rounding 49.9% into 50%)
    if (clampedRatio >= threshold) {
      seenIds.add(place.id);
      scoredBuildings.push({
        place,
        coverageRatio: clampedRatio,
        intersectionArea: interArea,
      });
    }
  }

  // Stable sort:
  // 1. coverageRatio descending
  // 2. intersectionArea descending
  // 3. id ascending
  scoredBuildings.sort((a, b) => {
    if (b.coverageRatio !== a.coverageRatio) {
      return b.coverageRatio - a.coverageRatio;
    }
    if (b.intersectionArea !== a.intersectionArea) {
      return b.intersectionArea - a.intersectionArea;
    }
    return a.place.id.localeCompare(b.place.id);
  });

  return scoredBuildings.map(({ place, coverageRatio }) => ({
    ...place,
    coverageRatio: Math.round(coverageRatio * 1e6) / 1e6, // Clean float up to 6 decimals
  }));
}
