import { BoundingBox, OSMPlace, ReverseGeocodeResult } from './types';

/**
 * Computes bounding box for a ring or set of coordinates
 */
export function computeBoundingBox(rings: number[][][]): BoundingBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return {
    minLon: isFinite(minLon) ? minLon : 0,
    minLat: isFinite(minLat) ? minLat : 0,
    maxLon: isFinite(maxLon) ? maxLon : 0,
    maxLat: isFinite(maxLat) ? maxLat : 0,
  };
}

/**
 * Point-in-polygon ray-casting algorithm
 * @param point [lon, lat]
 * @param ring Array of [lon, lat]
 */
export function isPointInRing(point: [number, number], ring: number[][]): boolean {
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Check if point is inside a GeoJSON Polygon
 * (Inside outer ring and NOT inside any inner holes)
 */
export function isPointInPolygon(point: [number, number], polygonCoords: number[][][]): boolean {
  if (!polygonCoords || polygonCoords.length === 0) return false;

  // Check outer ring
  const inOuter = isPointInRing(point, polygonCoords[0]);
  if (!inOuter) return false;

  // Check holes
  for (let i = 1; i < polygonCoords.length; i++) {
    if (isPointInRing(point, polygonCoords[i])) {
      return false; // Inside a hole, so not inside the polygon
    }
  }

  return true;
}

/**
 * Calculate distance between two lat/lon points in meters using Haversine formula
 */
export function haversineDistanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const R = 6371000; // Radius of Earth in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Distance in meters from point (lon, lat) to line segment (x1, y1)-(x2, y2)
 */
export function pointToSegmentDistanceMeters(
  lon: number,
  lat: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const mPerDegLat = 111139;
  const mPerDegLon = 111139 * cosLat;

  const dx = (lon - x1) * mPerDegLon;
  const dy = (lat - y1) * mPerDegLat;
  const sx = (x2 - x1) * mPerDegLon;
  const sy = (y2 - y1) * mPerDegLat;

  const lenSq = sx * sx + sy * sy;
  if (lenSq === 0) {
    return Math.sqrt(dx * dx + dy * dy);
  }

  const t = Math.max(0, Math.min(1, (dx * sx + dy * sy) / lenSq));
  const projX = t * sx;
  const projY = t * sy;
  const diffX = dx - projX;
  const diffY = dy - projY;
  return Math.sqrt(diffX * diffX + diffY * diffY);
}

/**
 * Shortest distance in meters from (lon, lat) to a Polygon or MultiPolygon outer boundary.
 * Returns 0 if point is inside.
 */
export function distanceToPolygonMeters(
  lon: number,
  lat: number,
  geometryType: 'Polygon' | 'MultiPolygon' | 'Point',
  geometry: any,
  center?: [number, number]
): number {
  const point: [number, number] = [lon, lat];

  if (geometryType === 'Polygon') {
    const poly = geometry as { coordinates: number[][][] };
    if (isPointInPolygon(point, poly.coordinates)) {
      return 0;
    }
    const outerRing = poly.coordinates[0];
    if (!outerRing || outerRing.length < 2) {
      if (center) return haversineDistanceMeters(lon, lat, center[0], center[1]);
      return Infinity;
    }
    let minDist = Infinity;
    for (let i = 0; i < outerRing.length - 1; i++) {
      const p1 = outerRing[i];
      const p2 = outerRing[i + 1];
      const d = pointToSegmentDistanceMeters(lon, lat, p1[0], p1[1], p2[0], p2[1]);
      if (d < minDist) minDist = d;
    }
    return minDist;
  } else if (geometryType === 'MultiPolygon') {
    const multi = geometry as { coordinates: number[][][][] };
    let minDist = Infinity;
    for (const polyCoords of multi.coordinates) {
      if (isPointInPolygon(point, polyCoords)) {
        return 0;
      }
      const outerRing = polyCoords[0];
      if (!outerRing || outerRing.length < 2) continue;
      for (let i = 0; i < outerRing.length - 1; i++) {
        const p1 = outerRing[i];
        const p2 = outerRing[i + 1];
        const d = pointToSegmentDistanceMeters(lon, lat, p1[0], p1[1], p2[0], p2[1]);
        if (d < minDist) minDist = d;
      }
    }
    return minDist;
  } else if (geometryType === 'Point') {
    const coords = (geometry as { coordinates: [number, number] }).coordinates;
    return haversineDistanceMeters(lon, lat, coords[0], coords[1]);
  }

  if (center) {
    return haversineDistanceMeters(lon, lat, center[0], center[1]);
  }
  return Infinity;
}

/**
 * Spatial Index and Query Engine for OSM administrative entities and places
 */
export class SpatialIndex {
  private places: OSMPlace[] = [];

  constructor(initialPlaces: OSMPlace[] = []) {
    this.places = initialPlaces;
  }

  public setPlaces(places: OSMPlace[]) {
    this.places = places;
  }

  public getPlaces(): OSMPlace[] {
    return this.places;
  }

  public addPlace(place: OSMPlace) {
    this.places.push(place);
  }

  public clear() {
    this.places = [];
  }

  public size(): number {
    return this.places.length;
  }

  /**
   * Reverse geocode a coordinate: find all OSM entities containing this coordinate,
   * sorted by administrative priority / hierarchy, with nearby POIs separated.
   */
  public query(
    lat: number,
    lon: number,
    order: 'narrow_to_broad' | 'broad_to_narrow' = 'narrow_to_broad',
    maxPoiDistanceMeters = 150,
    includeNearby = true,
    fallbackNearestBuilding = true,
    maxBuildingDistanceMeters = 2000
  ): ReverseGeocodeResult {
    const startTime = Date.now();
    const queryPoint: [number, number] = [lon, lat];

    const containingPlaces: OSMPlace[] = [];
    const nearbyPois: OSMPlace[] = [];

    for (const place of this.places) {
      // 1. Quick BBox pre-filter
      const { bbox } = place;
      const buffer = place.geometryType === 'Point' ? 0.003 : 0.0001; // small tolerance for bbox filter
      if (
        lon < bbox.minLon - buffer ||
        lon > bbox.maxLon + buffer ||
        lat < bbox.minLat - buffer ||
        lat > bbox.maxLat + buffer
      ) {
        continue;
      }

      // 2. Geometry type check
      if (place.geometryType === 'Polygon') {
        const poly = place.geometry as { coordinates: number[][][] };
        if (isPointInPolygon(queryPoint, poly.coordinates)) {
          containingPlaces.push({
            ...place,
            isContained: true,
            distanceMeters: 0,
          });
        }
      } else if (place.geometryType === 'MultiPolygon') {
        const multiPoly = place.geometry as { coordinates: number[][][][] };
        let inside = false;
        for (const polyCoords of multiPoly.coordinates) {
          if (isPointInPolygon(queryPoint, polyCoords)) {
            inside = true;
            break;
          }
        }
        if (inside) {
          containingPlaces.push({
            ...place,
            isContained: true,
            distanceMeters: 0,
          });
        }
      } else if (place.geometryType === 'Point' && includeNearby) {
        // Point POI: calculate geodesic distance in meters
        const [pLon, pLat] = (place.geometry as { coordinates: [number, number] }).coordinates;
        const dist = haversineDistanceMeters(lon, lat, pLon, pLat);
        if (dist <= maxPoiDistanceMeters) {
          nearbyPois.push({
            ...place,
            isContained: dist <= 5, // practically identical coordinate (within 5 meters)
            distanceMeters: Math.round(dist),
            tags: {
              ...place.tags,
              _distance_meters: Math.round(dist).toString(),
            },
          });
        }
      }
    }

    // Check if any building strictly contains the query coordinate
    const hasContainingBuilding = containingPlaces.some((p) => p.placeType === 'building');

    // If no building strictly contains the coordinate, find the nearest building in places
    let nearestBuildingPlace: OSMPlace | null = null;
    let minBuildingDist = Infinity;

    if (!hasContainingBuilding && fallbackNearestBuilding) {
      const degBuffer = (maxBuildingDistanceMeters / 111000) * 1.5;

      for (const place of this.places) {
        if (place.placeType !== 'building') continue;

        // Quick BBox distance pre-filter
        const { bbox } = place;
        if (
          lon < bbox.minLon - degBuffer ||
          lon > bbox.maxLon + degBuffer ||
          lat < bbox.minLat - degBuffer ||
          lat > bbox.maxLat + degBuffer
        ) {
          continue;
        }

        const dist = distanceToPolygonMeters(
          lon,
          lat,
          place.geometryType,
          place.geometry,
          place.center
        );

        if (dist <= maxBuildingDistanceMeters && dist < minBuildingDist) {
          minBuildingDist = dist;
          nearestBuildingPlace = {
            ...place,
            isContained: false,
            distanceMeters: Math.round(dist),
            tags: {
              ...place.tags,
              _distance_meters: Math.round(dist).toString(),
              _is_nearest_fallback: 'true',
            },
          };
        }
      }

    }

    // Sort containing places by priority rank
    containingPlaces.sort((a, b) => {
      if (order === 'narrow_to_broad') {
        if (a.priorityRank !== b.priorityRank) {
          return a.priorityRank - b.priorityRank;
        }
        return (a.areaApproxKm2 || 0) - (b.areaApproxKm2 || 0);
      } else {
        if (a.priorityRank !== b.priorityRank) {
          return b.priorityRank - a.priorityRank;
        }
        return (b.areaApproxKm2 || 0) - (a.areaApproxKm2 || 0);
      }
    });

    // Sort nearby POIs by distance (closest first)
    nearbyPois.sort((a, b) => (a.distanceMeters || 0) - (b.distanceMeters || 0));

    // Build structured hierarchy lookup object
    const hierarchy: ReverseGeocodeResult['hierarchy'] = {};
    for (const p of containingPlaces) {
      if (p.placeType === 'building' && !hierarchy.building) {
        hierarchy.building = p;
      } else if ((p.placeType === 'ward' || p.adminLevel === 8) && !hierarchy.ward) {
        hierarchy.ward = p;
      } else if ((p.placeType === 'district' || p.adminLevel === 6) && !hierarchy.district) {
        hierarchy.district = p;
      } else if ((p.placeType === 'province' || p.adminLevel === 4) && !hierarchy.province) {
        hierarchy.province = p;
      } else if ((p.placeType === 'region' || p.adminLevel === 3) && !hierarchy.region) {
        hierarchy.region = p;
      } else if ((p.placeType === 'country' || p.adminLevel === 2) && !hierarchy.country) {
        hierarchy.country = p;
      }
    }
    // A fallback is useful for navigation, but it is not a containing boundary.
    if (!hierarchy.building && nearestBuildingPlace) hierarchy.building = nearestBuildingPlace;

    // Associate closest POI if within 25m or top nearby POI
    if (nearbyPois.length > 0 && (nearbyPois[0].distanceMeters || 0) <= 30) {
      hierarchy.poi = nearbyPois[0];
    }

    // Build human-friendly administrative path
    const fullPath: string[] = [];
    if (hierarchy.building?.isContained) fullPath.push(hierarchy.building.name);
    if (hierarchy.ward) fullPath.push(hierarchy.ward.name);
    if (hierarchy.district) fullPath.push(hierarchy.district.name);
    if (hierarchy.province) fullPath.push(hierarchy.province.name);
    if (hierarchy.country) fullPath.push(hierarchy.country.name);

    const totalContainedCount = containingPlaces.filter((p) => p.isContained === true).length;

    return {
      query: {
        lat,
        lon,
        order,
      },
      totalFound: containingPlaces.length + nearbyPois.length + (nearestBuildingPlace ? 1 : 0),
      totalContained: totalContainedCount,
      totalNearby: nearbyPois.length,
      hierarchy,
      fullPath,
      places: containingPlaces,
      nearbyPois,
      allMatches: [...containingPlaces, ...nearbyPois, ...(nearestBuildingPlace ? [nearestBuildingPlace] : [])],
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Return GeoJSON FeatureCollection of all or filtered layers
   * Limits rendered building polygons on the map overview to prevent browser canvas freeze
   */
  public toGeoJSON(adminLevelFilter?: number | string, maxBuildingFeatures = 4000) {
    let buildingCount = 0;
    const features: any[] = [];

    for (const p of this.places) {
      if (adminLevelFilter !== undefined) {
        if (p.adminLevel.toString() !== adminLevelFilter.toString()) {
          continue;
        }
      }

      // If building, limit total rendered features on map layer
      if (p.placeType === 'building' || p.adminLevel === 'building') {
        if (buildingCount >= maxBuildingFeatures) {
          continue;
        }
        buildingCount++;
      }

      features.push({
        type: 'Feature',
        id: p.id,
        properties: {
          id: p.id,
          osmId: p.osmId,
          osmType: p.osmType,
          name: p.name,
          nameVi: p.nameVi || p.name,
          nameEn: p.nameEn || '',
          adminLevel: p.adminLevel,
          adminLevelLabel: p.adminLevelLabel,
          priorityRank: p.priorityRank,
          placeType: p.placeType,
          tags: p.tags,
          areaApproxKm2: p.areaApproxKm2,
        },
        geometry: {
          type: p.geometryType,
          coordinates: (p.geometry as any).coordinates,
        },
      });
    }

    return {
      type: 'FeatureCollection',
      features,
    };
  }
}
