/**
 * CLI Script: Stream & Import Large OSM XML (.osm) directly into PostgreSQL
 *
 * Usage:
 *   npx tsx scripts/import_large_osm_xml.ts <path-to-file.osm> [batchSize]
 *
 * Example:
 *   npx tsx scripts/import_large_osm_xml.ts ./vietnam-latest.osm 500
 *
 * Environment variables:
 *   - DATABASE_URL: postgres://user:password@host:5432/dbname
 *   OR
 *   - SQL_HOST, SQL_USER, SQL_PASSWORD, SQL_DB_NAME, SQL_PORT
 */

import fs from 'fs';
import path from 'path';
import sax from 'sax';
import { db } from '../src/db/index.ts';
import { osmPlaces, importLogs } from '../src/db/schema.ts';
import { sql } from 'drizzle-orm';
import { OSMPlace, OSMTags } from '../server/types.ts';
import { computeBoundingBox } from '../server/spatialIndex.ts';
import { getAdminMeta, formatBuildingName } from '../server/pbfParser.ts';

// Bounding box filter for Vietnam (optional safety boundary)
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
  batch.length = 0; // Clear array in place to free memory
  return count;
}

async function run() {
  const args = process.argv.slice(2);
  const filePath = args[0];
  const batchSize = parseInt(args[1] || '500', 10);

  if (!filePath) {
    console.error('❌ Thiếu đường dẫn file XML.');
    console.log('Cách dùng:');
    console.log('  npx tsx scripts/import_large_osm_xml.ts <duong-dan-file.osm> [batchSize]');
    console.log('Ví dụ:');
    console.log('  npx tsx scripts/import_large_osm_xml.ts ./vietnam.osm 500');
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
  console.log(`🚀 BẮT ĐẦU ĐỌC VÀ LƯU FILE OSM XML VÀO POSTGRESQL`);
  console.log(`📁 File: ${fileName} (${fileSizeMb} MB)`);
  console.log(`📦 Batch size: ${batchSize} records/insert`);
  console.log('====================================================');

  const startTime = Date.now();
  let totalSaved = 0;
  let batchBuffer: OSMPlace[] = [];

  // Memory map for node coordinates (needed to reconstruct polygons from ways)
  // [lon, lat] packed or stored
  const nodeCoords = new Map<number, [number, number]>();

  interface TempWay {
    id: number;
    refs: number[];
    tags: OSMTags;
  }

  interface TempRelation {
    id: number;
    members: Array<{ type: string; id: number; role: string }>;
    tags: OSMTags;
  }

  const pendingWays = new Map<number, TempWay>();
  const pendingRelations: TempRelation[] = [];

  let currentNode: { id: number; lat: number; lon: number; tags: OSMTags } | null = null;
  let currentWay: { id: number; refs: number[]; tags: OSMTags } | null = null;
  let currentRelation: {
    id: number;
    members: Array<{ type: string; id: number; role: string }>;
    tags: OSMTags;
  } | null = null;

  let nodeCount = 0;
  let wayCount = 0;
  let relationCount = 0;
  let lastProgressTime = Date.now();

  const fileStream = fs.createReadStream(resolvedPath);
  const saxStream = sax.createStream(true, { trim: true });

  fileStream.pipe(saxStream);

  saxStream.on('error', (err: any) => {
    console.error('❌ Lỗi XML SAX Parser:', err.message);
  });

  saxStream.on('opentag', (node: sax.Tag) => {
    const tagName = node.name;
    const attrs = node.attributes as Record<string, string>;

    if (tagName === 'node') {
      const id = parseInt(attrs.id, 10);
      const lat = parseFloat(attrs.lat);
      const lon = parseFloat(attrs.lon);
      if (!isNaN(id) && !isNaN(lat) && !isNaN(lon)) {
        currentNode = { id, lat, lon, tags: {} };
      }
    } else if (tagName === 'way') {
      const id = parseInt(attrs.id, 10);
      if (!isNaN(id)) {
        currentWay = { id, refs: [], tags: {} };
      }
    } else if (tagName === 'relation') {
      const id = parseInt(attrs.id, 10);
      if (!isNaN(id)) {
        currentRelation = { id, members: [], tags: {} };
      }
    } else if (tagName === 'tag') {
      const k = attrs.k;
      const v = attrs.v;
      if (k && v !== undefined) {
        if (currentNode) currentNode.tags[k] = v;
        else if (currentWay) currentWay.tags[k] = v;
        else if (currentRelation) currentRelation.tags[k] = v;
      }
    } else if (tagName === 'nd') {
      if (currentWay && attrs.ref) {
        const ref = parseInt(attrs.ref, 10);
        if (!isNaN(ref)) currentWay.refs.push(ref);
      }
    } else if (tagName === 'member') {
      if (currentRelation && attrs.ref) {
        const ref = parseInt(attrs.ref, 10);
        if (!isNaN(ref)) {
          currentRelation.members.push({
            type: attrs.type || 'way',
            id: ref,
            role: attrs.role || '',
          });
        }
      }
    }
  });

  saxStream.on('closetag', async (tagName: string) => {
    if (tagName === 'node' && currentNode) {
      nodeCount++;
      const { id, lat, lon, tags } = currentNode;

      // Filter in Vietnam or store
      if (lat >= VN_BBOX.minLat && lat <= VN_BBOX.maxLat && lon >= VN_BBOX.minLon && lon <= VN_BBOX.maxLon) {
        nodeCoords.set(id, [lon, lat]);

        const name = tags.name || tags['name:vi'] || tags['name:en'];
        // Check if this node is an interesting POI / Place
        if (
          name &&
          (tags.place ||
            tags.amenity ||
            tags.tourism ||
            tags.historic ||
            tags.leisure ||
            tags.shop ||
            tags.building)
        ) {
          const meta = getAdminMeta(tags);
          batchBuffer.push({
            id: `node/${id}`,
            osmId: id,
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
            saxStream.pause();
            const saved = await flushBatch(batchBuffer, fileName);
            totalSaved += saved;
            saxStream.resume();
          }
        }
      }
      currentNode = null;
    } else if (tagName === 'way' && currentWay) {
      wayCount++;
      const { id, refs, tags } = currentWay;
      const isBuilding = !!tags.building && tags.building !== 'no';
      const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;

      if ((isBuilding || isBoundary) && refs.length >= 3) {
        pendingWays.set(id, currentWay);
      }
      currentWay = null;
    } else if (tagName === 'relation' && currentRelation) {
      relationCount++;
      const { tags } = currentRelation;
      if (tags.boundary === 'administrative' || tags.type === 'boundary' || tags.type === 'multipolygon') {
        pendingRelations.push(currentRelation);
      }
      currentRelation = null;
    }

    // Periodic progress print
    const now = Date.now();
    if (now - lastProgressTime > 3000) {
      lastProgressTime = now;
      const memMb = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(0);
      process.stdout.write(
        `\r⏳ Tiến trình: ${nodeCount.toLocaleString()} nodes | ${wayCount.toLocaleString()} ways | ${relationCount.toLocaleString()} relations | Đã lưu Postgres: ${totalSaved.toLocaleString()} | RAM: ${memMb}MB`
      );
    }
  });

  await new Promise<void>((resolve, reject) => {
    saxStream.on('end', () => resolve());
    saxStream.on('error', (e) => reject(e));
    fileStream.on('error', (e) => reject(e));
  });

  console.log('\n\n🔄 Đang xử lý Ways (Nhà, Tòa nhà, Ranh giới)...');

  // Process Ways (Buildings & Boundaries)
  for (const [wayId, way] of pendingWays.entries()) {
    const isBuilding = !!way.tags.building && way.tags.building !== 'no';
    const isBoundary = way.tags.boundary === 'administrative';

    const coords: number[][] = [];
    for (const ref of way.refs) {
      const pt = nodeCoords.get(ref);
      if (pt) coords.push(pt);
    }

    if (coords.length < 3) continue;

    // Ensure ring is closed
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push([first[0], first[1]]);
    }

    const rings = [coords];
    const bbox = computeBoundingBox(rings);
    const center: [number, number] = [
      (bbox.minLon + bbox.maxLon) / 2,
      (bbox.minLat + bbox.maxLat) / 2,
    ];
    const area = calculateApproxAreaKm2(rings);

    if (isBuilding) {
      const name = formatBuildingName(way.tags, wayId);
      const buildingType = way.tags.building;
      const label =
        buildingType === 'commercial' || buildingType === 'office'
          ? 'Tòa nhà Văn phòng / Thương mại'
          : buildingType === 'apartments'
          ? 'Chung cư / Khu căn hộ'
          : buildingType === 'hospital'
          ? 'Bệnh viện / Cơ sở Y tế'
          : buildingType === 'school' || buildingType === 'university'
          ? 'Trường học / Cơ sở Giáo dục'
          : 'Công trình / Tòa nhà';

      batchBuffer.push({
        id: `way/${wayId}`,
        osmId: wayId,
        osmType: 'way',
        name,
        nameVi: way.tags['name:vi'] || name,
        nameEn: way.tags['name:en'] || '',
        adminLevel: 'building',
        adminLevelLabel: label,
        priorityRank: 0.5,
        placeType: 'building',
        tags: way.tags,
        bbox,
        center,
        geometryType: 'Polygon',
        geometry: { coordinates: rings },
        areaApproxKm2: area,
      });
    } else if (isBoundary) {
      const name = way.tags.name || way.tags['name:vi'] || `Ranh giới #${wayId}`;
      const meta = getAdminMeta(way.tags);
      batchBuffer.push({
        id: `way/${wayId}`,
        osmId: wayId,
        osmType: 'way',
        name,
        nameVi: way.tags['name:vi'] || name,
        nameEn: way.tags['name:en'] || '',
        adminLevel: meta.adminLevel,
        adminLevelLabel: meta.adminLevelLabel,
        priorityRank: meta.priorityRank,
        placeType: meta.placeType,
        tags: way.tags,
        bbox,
        center,
        geometryType: 'Polygon',
        geometry: { coordinates: rings },
        areaApproxKm2: area,
      });
    }

    if (batchBuffer.length >= batchSize) {
      const saved = await flushBatch(batchBuffer, fileName);
      totalSaved += saved;
      process.stdout.write(`\r💾 Đang lưu Ways vào Postgres: ${totalSaved.toLocaleString()} địa điểm...`);
    }
  }

  console.log('\n🔄 Đang xử lý Relations (Quan hệ Hành chính Cấp 2, 4, 6, 8)...');

  // Process Relations
  for (const rel of pendingRelations) {
    const meta = getAdminMeta(rel.tags);
    const name = rel.tags.name || rel.tags['name:vi'] || rel.tags['name:en'];
    if (!name) continue;

    // Collect outer ways
    const outerWays: number[][][] = [];
    for (const member of rel.members) {
      if (member.type === 'way') {
        const way = pendingWays.get(member.id);
        if (way && way.refs.length >= 2) {
          const wayCoords: number[][] = [];
          for (const ref of way.refs) {
            const pt = nodeCoords.get(ref);
            if (pt) wayCoords.push(pt);
          }
          if (wayCoords.length >= 2) {
            outerWays.push(wayCoords);
          }
        }
      }
    }

    if (outerWays.length === 0) continue;

    const flattened = outerWays.flat();
    if (flattened.length < 3) continue;

    const ringCoords = [flattened];
    // Close ring if not closed
    const firstPt = flattened[0];
    const lastPt = flattened[flattened.length - 1];
    if (firstPt[0] !== lastPt[0] || firstPt[1] !== lastPt[1]) {
      flattened.push([firstPt[0], firstPt[1]]);
    }

    const bbox = computeBoundingBox(ringCoords);
    const center: [number, number] = [
      (bbox.minLon + bbox.maxLon) / 2,
      (bbox.minLat + bbox.maxLat) / 2,
    ];
    const area = calculateApproxAreaKm2(ringCoords);

    batchBuffer.push({
      id: `rel/${rel.id}`,
      osmId: rel.id,
      osmType: 'relation',
      name,
      nameVi: rel.tags['name:vi'] || name,
      nameEn: rel.tags['name:en'] || '',
      adminLevel: meta.adminLevel,
      adminLevelLabel: meta.adminLevelLabel,
      priorityRank: meta.priorityRank,
      placeType: meta.placeType,
      tags: rel.tags,
      bbox,
      center,
      geometryType: 'Polygon',
      geometry: { coordinates: ringCoords },
      areaApproxKm2: area,
    });

    if (batchBuffer.length >= batchSize) {
      const saved = await flushBatch(batchBuffer, fileName);
      totalSaved += saved;
      process.stdout.write(`\r💾 Đang lưu Relations vào Postgres: ${totalSaved.toLocaleString()} địa điểm...`);
    }
  }

  // Flush remaining buffer
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
  console.log(`✅ HOÀN TẤT IMPORT FILE OSM XML VÀO POSTGRESQL!`);
  console.log(`⏱️ Thời gian thực thi: ${durationSec}s`);
  console.log(`📍 Tổng số địa điểm lưu vào database: ${totalSaved.toLocaleString()}`);
  console.log(`🏠 Cơ sở dữ liệu Postgres: Bảng osm_places đã được cập nhật thành công.`);
  console.log('====================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Có lỗi xảy ra trong quá trình import:', err);
  process.exit(1);
});
