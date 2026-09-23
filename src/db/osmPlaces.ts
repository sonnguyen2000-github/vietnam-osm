import { and, asc, count, desc, eq, inArray, lte, gte, sql } from 'drizzle-orm';
import { db } from './index.ts';
import { osmPlaces, importLogs } from './schema.ts';
import { OSMPlace, BoundingBox } from '../../server/types.ts';

function rowToPlace(row: typeof osmPlaces.$inferSelect): OSMPlace {
  return {
    id: row.id, osmId: Number(row.osmId), osmType: row.osmType as OSMPlace['osmType'],
    name: row.name, nameVi: row.nameVi || undefined, nameEn: row.nameEn || undefined,
    adminLevel: isNaN(Number(row.adminLevel)) ? row.adminLevel : Number(row.adminLevel),
    adminLevelLabel: row.adminLevelLabel, priorityRank: row.placeType === 'building' ? 0.5 : row.priorityRank,
    placeType: row.placeType as OSMPlace['placeType'], tags: (row.tags as Record<string, string>) || {},
    bbox: { minLon: row.minLon, minLat: row.minLat, maxLon: row.maxLon, maxLat: row.maxLat },
    center: [row.centerLon, row.centerLat], geometryType: row.geometryType as OSMPlace['geometryType'],
    geometry: row.geometry as OSMPlace['geometry'], areaApproxKm2: row.areaApproxKm2 ?? undefined,
  };
}

export interface PlacesBboxQuery {
  minLon: number; minLat: number; maxLon: number; maxLat: number;
  adminLevels?: string[]; limit?: number; orderFrom?: { lon: number; lat: number };
}

export async function getPlacesByBbox(query: PlacesBboxQuery): Promise<OSMPlace[]> {
  const conditions = [
    lte(osmPlaces.minLon, query.maxLon), gte(osmPlaces.maxLon, query.minLon),
    lte(osmPlaces.minLat, query.maxLat), gte(osmPlaces.maxLat, query.minLat),
  ];
  if (query.adminLevels?.length) conditions.push(inArray(osmPlaces.adminLevel, query.adminLevels));
  const rows = await db.select().from(osmPlaces).where(and(...conditions))
    .orderBy(
      ...(query.orderFrom
        ? [sql`power(${osmPlaces.centerLon} - ${query.orderFrom.lon}, 2) + power(${osmPlaces.centerLat} - ${query.orderFrom.lat}, 2)`]
        : [asc(osmPlaces.priorityRank), asc(osmPlaces.id)])
    )
    .limit(Math.min(Math.max(query.limit ?? 5000, 1), 10000));
  return rows.map(rowToPlace);
}

export interface BuildingCandidatesResult {
  candidates: OSMPlace[];
  hasOverflow: boolean;
  totalFetched: number;
}

/**
 * Fetch candidate buildings intersecting selection bbox.
 * Queries up to limit + 1 to detect candidate overflow without silent truncation.
 */
export async function getBuildingCandidatesForBbox(
  bbox: BoundingBox,
  limit = 3000
): Promise<BuildingCandidatesResult> {
  const conditions = [
    eq(osmPlaces.placeType, 'building'),
    inArray(osmPlaces.geometryType, ['Polygon', 'MultiPolygon']),
    lte(osmPlaces.minLon, bbox.maxLon),
    gte(osmPlaces.maxLon, bbox.minLon),
    lte(osmPlaces.minLat, bbox.maxLat),
    gte(osmPlaces.maxLat, bbox.minLat),
  ];

  const queryLimit = Math.max(1, limit) + 1;
  const rows = await db
    .select()
    .from(osmPlaces)
    .where(and(...conditions))
    .orderBy(asc(osmPlaces.id))
    .limit(queryLimit);

  const hasOverflow = rows.length > limit;
  const candidatesRows = hasOverflow ? rows.slice(0, limit) : rows;

  return {
    candidates: candidatesRows.map(rowToPlace),
    hasOverflow,
    totalFetched: rows.length,
  };
}

/**
 * Check if the database has any OSM places stored
 */
export async function getStoredPlacesCount(): Promise<number> {
  try {
    const res = await db.select({ value: count() }).from(osmPlaces);
    return res[0]?.value ?? 0;
  } catch (error) {
    console.error('Failed to get stored places count from Postgres:', error);
    return 0;
  }
}

/**
 * Batch insert or update OSM places into PostgreSQL
 */
export async function savePlacesToDb(
  places: OSMPlace[],
  source = 'import',
  filename?: string,
  fileSize?: number
): Promise<{ saved: number; total: number }> {
  try {
    if (!places || places.length === 0) {
      return { saved: 0, total: 0 };
    }

    const rows = places.map((place) => ({
      id: place.id,
      osmId: Number(place.osmId),
      osmType: place.osmType,
      name: place.name,
      nameVi: place.nameVi ?? null,
      nameEn: place.nameEn ?? null,
      adminLevel: String(place.adminLevel),
      adminLevelLabel: place.adminLevelLabel,
      priorityRank: place.placeType === 'building' ? 0 : Math.round(Number(place.priorityRank) || 0),
      placeType: place.placeType,
      tags: place.tags || {},
      minLon: place.bbox.minLon,
      minLat: place.bbox.minLat,
      maxLon: place.bbox.maxLon,
      maxLat: place.bbox.maxLat,
      centerLon: place.center[0],
      centerLat: place.center[1],
      geometryType: place.geometryType,
      geometry: place.geometry,
      areaApproxKm2: place.areaApproxKm2 ?? null,
      source: source,
    }));

    // Chunk to prevent hitting Postgres max query parameter limits
    const CHUNK_SIZE = 150;
    let savedCount = 0;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await db
        .insert(osmPlaces)
        .values(chunk)
        .onConflictDoUpdate({
          target: osmPlaces.id,
          set: {
            name: sql`excluded.name`,
            nameVi: sql`excluded.name_vi`,
            nameEn: sql`excluded.name_en`,
            tags: sql`excluded.tags`,
            minLon: sql`excluded.min_lon`,
            minLat: sql`excluded.min_lat`,
            maxLon: sql`excluded.max_lon`,
            maxLat: sql`excluded.max_lat`,
            centerLon: sql`excluded.center_lon`,
            centerLat: sql`excluded.center_lat`,
            geometryType: sql`excluded.geometry_type`,
            geometry: sql`excluded.geometry`,
            areaApproxKm2: sql`excluded.area_approx_km2`,
            source: sql`excluded.source`,
          },
        });
      savedCount += chunk.length;
    }

    // Log the import event
    if (filename) {
      await db.insert(importLogs).values({
        filename,
        placesCount: places.length,
        fileSize: fileSize ?? null,
        status: 'success',
      });
    }

    return { saved: savedCount, total: places.length };
  } catch (error) {
    console.error('Failed to save places to Postgres:', error);
    throw new Error('Database operation failed while saving places.', { cause: error });
  }
}

/**
 * Get detailed stats about persisted data in Postgres
 */
export async function getDbStats() {
  try {
    const totalCountRes = await db.select({ value: count() }).from(osmPlaces);
    const totalPlaces = totalCountRes[0]?.value ?? 0;

    const recentLogs = await db
      .select()
      .from(importLogs)
      .orderBy(desc(importLogs.createdAt))
      .limit(10);

    return {
      connected: true,
      totalPlaces,
      recentImports: recentLogs,
    };
  } catch (error) {
    console.error('Failed to fetch DB stats:', error);
    return {
      connected: false,
      totalPlaces: 0,
      recentImports: [],
      error: (error as any)?.message || 'Database unavailable',
    };
  }
}
