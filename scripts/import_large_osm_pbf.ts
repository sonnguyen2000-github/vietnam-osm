/**
 * CLI Script: Stream & Import Large OSM PBF (.osm.pbf / .pbf) directly into PostgreSQL
 *
 * Usage:
 *   npx tsx scripts/import_large_osm_pbf.ts <path-to-file.osm.pbf> [batchSize]
 *
 * Example:
 *   npx tsx scripts/import_large_osm_pbf.ts ./vietnam-latest.osm.pbf 500
 *
 * Environment variables:
 *   - DATABASE_URL: postgresql://user:password@host:5432/dbname
 *   OR
 *   - SQL_HOST, SQL_USER, SQL_PASSWORD, SQL_DB_NAME, SQL_PORT
 */

import fs from 'fs';
import path from 'path';
// @ts-ignore - osm-pbf-parser has no types declaration
import parseOSM from 'osm-pbf-parser';
import { db } from '../src/db/index.ts';
import { osmPlaces, importLogs } from '../src/db/schema.ts';
import { sql } from 'drizzle-orm';
import { OSMPlace, OSMTags, GeoPolygon, GeoMultiPolygon } from '../server/types.ts';
import { computeBoundingBox } from '../server/spatialIndex.ts';
import { getAdminMeta, formatBuildingName } from '../server/pbfParser.ts';

// Bounding box filter for Vietnam
const VN_BBOX = {
  minLon: 102.0,
  maxLon: 110.5,
  minLat: 8.0,
  maxLat: 24.0,
};

function calculateApproxAreaKm2(rings: number[][][]): number {
  if (!rings || rings.length === 0 || !rings[0] || rings[0].length < 3) return 0;
  const ring = rings[0];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    area += (p2[0] - p1[0]) * (p2[1] + p1[1]);
  }
  return Math.abs(area / 2) * 111 * 106;
}

async function flushBatch(batch: OSMPlace[], sourceName: string): Promise<number> {
  if (batch.length === 0) return 0;

  const rows = batch.map((place) => ({
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
    source: sourceName,
  }));

  await db
    .insert(osmPlaces)
    .values(rows)
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

  const count = batch.length;
  batch.length = 0; // Free memory
  return count;
}

async function run() {
  const args = process.argv.slice(2);
  const filePath = args[0];
  const batchSize = parseInt(args[1] || '500', 10);

  if (!filePath) {
    console.error('❌ Thiếu đường dẫn file PBF.');
    console.log('Cách dùng:');
    console.log('  npx tsx scripts/import_large_osm_pbf.ts <duong-dan-file.osm.pbf> [batchSize]');
    console.log('Ví dụ:');
    console.log('  npx tsx scripts/import_large_osm_pbf.ts ./vietnam-latest.osm.pbf 500');
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ Không tìm thấy file: ${resolvedPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);
  const fileSizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  const fileName = path.basename(resolvedPath);

  console.log('====================================================');
  console.log(`🚀 BẮT ĐẦU ĐỌC VÀ LƯU FILE OSM PBF VÀO POSTGRESQL`);
  console.log(`📁 File: ${fileName} (${fileSizeMb} MB)`);
  console.log(`📦 Batch size: ${batchSize} records/insert`);
  console.log('====================================================');

  const startTime = Date.now();
  let totalSaved = 0;
  const batchBuffer: OSMPlace[] = [];

  // Temporary storage to resolve coordinates of ways
  const nodeCoords = new Map<number, [number, number]>();
  const pendingWays = new Map<number, { id: number; refs: number[]; tags: OSMTags }>();
  const pendingRelations: Array<{
    id: number;
    tags: OSMTags;
    members: Array<{ type: string; id: number; role?: string }>;
  }> = [];

  let nodesCount = 0;
  let waysCount = 0;
  let relationsCount = 0;
  let lastProgressTime = Date.now();

  const stream = fs.createReadStream(resolvedPath);
  const osm = parseOSM();

  stream.pipe(osm);

  osm.on('data', async (items: any[]) => {
    for (const item of items) {
      const tags = item.tags || {};
      const name = tags.name || tags['name:vi'] || tags['name:en'];

      if (item.type === 'node') {
        nodesCount++;
        if (item.lat !== undefined && item.lon !== undefined) {
          const lat = item.lat;
          const lon = item.lon;

          if (lat >= VN_BBOX.minLat && lat <= VN_BBOX.maxLat && lon >= VN_BBOX.minLon && lon <= VN_BBOX.maxLon) {
            nodeCoords.set(item.id, [lon, lat]);

            if (
              name &&
              (tags.place ||
                tags.amenity ||
                tags.tourism ||
                tags.historic ||
                tags.leisure ||
                tags.shop)
            ) {
              const meta = getAdminMeta(tags);
              batchBuffer.push({
                id: `node/${item.id}`,
                osmId: item.id,
                osmType: 'node',
                name,
                nameVi: tags['name:vi'] || name,
                nameEn: tags['name:en'] || '',
                adminLevel: meta.adminLevel,
                adminLevelLabel: meta.adminLevelLabel,
                priorityRank: meta.priorityRank,
                placeType: meta.placeType,
                tags,
                bbox: {
                  minLon: lon - 0.001,
                  maxLon: lon + 0.001,
                  minLat: lat - 0.001,
                  maxLat: lat + 0.001,
                },
                center: [lon, lat],
                geometryType: 'Point',
                geometry: { coordinates: [lon, lat] },
                areaApproxKm2: 0.01,
              });

              if (batchBuffer.length >= batchSize) {
                osm.pause();
                const saved = await flushBatch(batchBuffer, fileName);
                totalSaved += saved;
                osm.resume();
              }
            }
          }
        }
      } else if (item.type === 'way') {
        waysCount++;
        const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
        const isBuilding = tags.building !== undefined && tags.building !== 'no';
        const isPlace = tags.place !== undefined;
        const isPoi = tags.amenity !== undefined || tags.tourism !== undefined || tags.shop !== undefined;

        if ((isBoundary || isBuilding || isPlace || isPoi || name) && item.refs && item.refs.length >= 3) {
          pendingWays.set(item.id, {
            id: item.id,
            refs: item.refs,
            tags,
          });
        }
      } else if (item.type === 'relation') {
        relationsCount++;
        const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
        const isBuilding = tags.building !== undefined && tags.building !== 'no';
        const isTypeBoundary = tags.type === 'boundary' || tags.type === 'multipolygon';

        if ((isBoundary || isTypeBoundary || isBuilding) && item.members && item.members.length > 0) {
          pendingRelations.push({
            id: item.id,
            tags,
            members: item.members,
          });
        }
      }
    }

    const now = Date.now();
    if (now - lastProgressTime > 3000) {
      lastProgressTime = now;
      const memMb = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(0);
      process.stdout.write(
        `\r⏳ Quét PBF: ${nodesCount.toLocaleString()} nodes | ${waysCount.toLocaleString()} ways | ${relationsCount.toLocaleString()} relations | Đã lưu: ${totalSaved.toLocaleString()} | RAM: ${memMb}MB`
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    osm.on('end', () => resolve());
    osm.on('error', (e: any) => reject(e));
    stream.on('error', (e: any) => reject(e));
  });

  console.log('\n\n🔄 Đang xử lý dựng hình học Ways (Nhà cửa, Tòa nhà, Ranh giới)...');

  const wayRings = new Map<number, number[][]>();

  for (const [wayId, way] of pendingWays.entries()) {
    const ring: number[][] = [];
    for (const ref of way.refs) {
      const coord = nodeCoords.get(ref);
      if (coord) ring.push(coord);
    }

    if (ring.length < 3) continue;

    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([...first]);
    }

    wayRings.set(wayId, ring);

    const tags = way.tags;
    const isBuilding = tags.building !== undefined && tags.building !== 'no';
    const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;

    let name = tags.name || tags['name:vi'] || tags['name:en'];
    if (!name && isBuilding) {
      name = formatBuildingName(tags, wayId);
    } else if (!name) {
      name = `Way #${wayId}`;
    }

    const meta = getAdminMeta(tags);
    const bbox = computeBoundingBox([ring]);
    const center: [number, number] = [
      (bbox.minLon + bbox.maxLon) / 2,
      (bbox.minLat + bbox.maxLat) / 2,
    ];
    const area = calculateApproxAreaKm2([ring]);

    batchBuffer.push({
      id: `way/${wayId}`,
      osmId: wayId,
      osmType: 'way',
      name,
      nameVi: tags['name:vi'] || name,
      nameEn: tags['name:en'] || '',
      adminLevel: meta.adminLevel,
      adminLevelLabel: meta.adminLevelLabel,
      priorityRank: isBuilding ? 0.5 : meta.priorityRank,
      placeType: isBuilding ? 'building' : meta.placeType,
      tags,
      bbox,
      center,
      geometryType: 'Polygon',
      geometry: { coordinates: [ring] },
      areaApproxKm2: area,
    });

    if (batchBuffer.length >= batchSize) {
      const saved = await flushBatch(batchBuffer, fileName);
      totalSaved += saved;
      process.stdout.write(`\r💾 Đang lưu Ways vào Postgres: ${totalSaved.toLocaleString()} địa điểm...`);
    }
  }

  console.log('\n🔄 Đang xử lý dựng hình học Relations (Cấp 2, 4, 6, 8, Phường, Xã, Quận)...');

  for (const rel of pendingRelations) {
    const tags = rel.tags;
    const outerRings: number[][][] = [];

    for (const member of rel.members) {
      if (member.type === 'way') {
        const ring = wayRings.get(member.id);
        if (ring && ring.length >= 3) {
          outerRings.push(ring);
        }
      }
    }

    if (outerRings.length > 0) {
      const name = tags.name || tags['name:vi'] || tags['name:en'] || `Relation #${rel.id}`;
      const meta = getAdminMeta(tags);
      const bbox = computeBoundingBox(outerRings);
      const center: [number, number] = [
        (bbox.minLon + bbox.maxLon) / 2,
        (bbox.minLat + bbox.maxLat) / 2,
      ];
      const area = calculateApproxAreaKm2(outerRings);

      const isSingle = outerRings.length === 1;
      const geometry: GeoPolygon | GeoMultiPolygon = isSingle
        ? { coordinates: [outerRings[0]] }
        : { coordinates: outerRings.map((r) => [r]) };

      batchBuffer.push({
        id: `relation/${rel.id}`,
        osmId: rel.id,
        osmType: 'relation',
        name,
        nameVi: tags['name:vi'] || name,
        nameEn: tags['name:en'] || '',
        adminLevel: meta.adminLevel,
        adminLevelLabel: meta.adminLevelLabel,
        priorityRank: meta.priorityRank,
        placeType: meta.placeType,
        tags,
        bbox,
        center,
        geometryType: isSingle ? 'Polygon' : 'MultiPolygon',
        geometry,
        areaApproxKm2: area,
      });

      if (batchBuffer.length >= batchSize) {
        const saved = await flushBatch(batchBuffer, fileName);
        totalSaved += saved;
        process.stdout.write(`\r💾 Đang lưu Relations vào Postgres: ${totalSaved.toLocaleString()} địa điểm...`);
      }
    }
  }

  // Flush remaining
  if (batchBuffer.length > 0) {
    const saved = await flushBatch(batchBuffer, fileName);
    totalSaved += saved;
  }

  // Record audit log
  await db.insert(importLogs).values({
    filename: fileName,
    placesCount: totalSaved,
    fileSize: stat.size,
    status: 'success',
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n====================================================');
  console.log(`✅ HOÀN TẤT IMPORT FILE OSM PBF VÀO POSTGRESQL!`);
  console.log(`⏱️ Thời gian thực thi: ${durationSec}s`);
  console.log(`📍 Tổng số địa điểm lưu vào database: ${totalSaved.toLocaleString()}`);
  console.log(`🏠 Cơ sở dữ liệu Postgres: Bảng osm_places đã được cập nhật thành công.`);
  console.log('====================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Có lỗi xảy ra trong quá trình import PBF:', err);
  process.exit(1);
});
