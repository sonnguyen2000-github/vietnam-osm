/**
 * Production-Grade 2-Pass OSM PBF Importer directly into PostgreSQL
 *
 * Designed to handle full-country OSM PBF files (like Vietnam 314MB with 46M nodes)
 * with low memory footprint (~500MB RAM) using coordinate bit-packing and 2-pass indexing.
 *
 * Usage:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx tsx scripts/import_large_osm_pbf.ts ./vietnam-260922.osm.pbf 500
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

// Compact coordinate packing: encode lon/lat into a single 53-bit JS number (10cm precision)
function packCoord(lon: number, lat: number): number {
  const iLat = Math.round((lat - 8.0) * 1000000);
  const iLon = Math.round((lon - 102.0) * 1000000);
  return iLat * 20000000 + iLon;
}

function unpackCoord(packed: number): [number, number] {
  const iLat = Math.floor(packed / 20000000);
  const iLon = packed % 20000000;
  return [
    Number((102.0 + iLon / 1000000).toFixed(6)),
    Number((8.0 + iLat / 1000000).toFixed(6)),
  ];
}

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
  batch.length = 0; // Clear memory
  return count;
}

async function run() {
  const args = process.argv.slice(2);
  const filePath = args[0];
  const batchSize = parseInt(args[1] || '500', 10);

  if (!filePath) {
    console.error('❌ Thiếu đường dẫn file PBF.');
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

  console.log('================================================================');
  console.log(`🚀 BẮT ĐẦU IMPORT FILE OSM PBF VÀO GOOGLE CLOUD SQL POSTGRESQL`);
  console.log(`📁 File: ${fileName} (${fileSizeMb} MB)`);
  console.log(`📦 Batch size: ${batchSize} bản ghi/lần`);
  console.log('================================================================');

  const startTime = Date.now();

  // -------------------------------------------------------------------------
  // PASS 1: Quét nhanh Ways & Relations để thu thập các node ID cần thiết
  // -------------------------------------------------------------------------
  console.log('\n🔍 [Pass 1/2] Đang quét cấu trúc Ways & Relations để lọc Node IDs...');
  const pass1Start = Date.now();

  const neededNodeIds = new Set<number>();
  const pendingWays = new Map<number, { id: number; refs: number[]; tags: OSMTags }>();
  const pendingRelations: Array<{
    id: number;
    tags: OSMTags;
    members: Array<{ type: string; id: number; role?: string }>;
  }> = [];

  let totalWays = 0;
  let totalRels = 0;

  await new Promise<void>((resolve, reject) => {
    const stream1 = fs.createReadStream(resolvedPath);
    const osm1 = parseOSM();

    osm1.on('data', (items: any[]) => {
      for (const item of items) {
        if (item.type === 'way') {
          totalWays++;
          const tags = item.tags || {};
          const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
          const isBuilding = tags.building && tags.building !== 'no';
          const isPlace = tags.place !== undefined;
          const isPoi = tags.amenity || tags.tourism || tags.historic || tags.leisure || tags.shop;
          const hasName = Boolean(tags.name || tags['name:vi'] || tags['name:en']);

          if ((isBoundary || isBuilding || isPlace || isPoi || hasName) && item.refs && item.refs.length >= 3) {
            pendingWays.set(item.id, {
              id: item.id,
              refs: item.refs,
              tags,
            });
            for (const ref of item.refs) {
              neededNodeIds.add(ref);
            }
          }
        } else if (item.type === 'relation') {
          totalRels++;
          const tags = item.tags || {};
          const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
          const isTypeBoundary = tags.type === 'boundary' || tags.type === 'multipolygon';
          const isBuilding = tags.building && tags.building !== 'no';

          if ((isBoundary || isTypeBoundary || isBuilding) && item.members && item.members.length > 0) {
            pendingRelations.push({
              id: item.id,
              tags,
              members: item.members,
            });
          }
        }
      }
    });

    osm1.on('end', () => resolve());
    osm1.on('error', (err: any) => reject(err));
    stream1.on('error', (err: any) => reject(err));
    stream1.pipe(osm1);
  });

  const pass1Duration = ((Date.now() - pass1Start) / 1000).toFixed(1);
  console.log(`✅ [Pass 1/2] Hoàn tất sau ${pass1Duration}s!`);
  console.log(`   - Tổng Ways: ${totalWays.toLocaleString()} (Chọn lọc: ${pendingWays.size.toLocaleString()})`);
  console.log(`   - Tổng Relations: ${totalRels.toLocaleString()} (Chọn lọc: ${pendingRelations.length.toLocaleString()})`);
  console.log(`   - Số lượng Node IDs cần nạp tọa độ: ${neededNodeIds.size.toLocaleString()}`);

  // -------------------------------------------------------------------------
  // PASS 2: Quét Nodes (lưu tọa độ compact + nạp POI/Địa danh có tên)
  // -------------------------------------------------------------------------
  console.log('\n📥 [Pass 2/2] Đang đọc tọa độ Node & bắt đầu nạp vào PostgreSQL...');
  const pass2Start = Date.now();

  const packedCoords = new Map<number, number>(); // NodeId -> packed number (350MB RAM max)
  let totalSaved = 0;
  const batchBuffer: OSMPlace[] = [];

  let nodesRead = 0;
  let namedNodesSaved = 0;
  let lastLogTime = Date.now();

  // Create stream pipeline with manual pause/resume for safe batch flushing
  await new Promise<void>((resolve, reject) => {
    const stream2 = fs.createReadStream(resolvedPath);
    const osm2 = parseOSM();

    let isFlushing = false;
    const itemQueue: any[][] = [];

    async function processQueue() {
      if (isFlushing) return;
      isFlushing = true;

      while (itemQueue.length > 0) {
        const items = itemQueue.shift()!;
        for (const item of items) {
          if (item.type !== 'node') continue; // In pass 2 we only process nodes; ways/relations are handled next
          nodesRead++;

          if (item.lat !== undefined && item.lon !== undefined) {
            const lat = item.lat;
            const lon = item.lon;

            // Check if node is in Vietnam
            if (lat >= VN_BBOX.minLat && lat <= VN_BBOX.maxLat && lon >= VN_BBOX.minLon && lon <= VN_BBOX.maxLon) {
              // 1. Cache coordinate for ways if needed
              if (neededNodeIds.has(item.id)) {
                packedCoords.set(item.id, packCoord(lon, lat));
              }

              // 2. If node is a named administrative place or POI, insert directly into Postgres
              const tags = item.tags || {};
              const name = tags.name || tags['name:vi'] || tags['name:en'];
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
                  stream2.pause();
                  const saved = await flushBatch(batchBuffer, fileName);
                  totalSaved += saved;
                  namedNodesSaved += saved;
                  stream2.resume();
                }
              }
            }
          }
        }

        const now = Date.now();
        if (now - lastLogTime > 4000) {
          lastLogTime = now;
          const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
          process.stdout.write(
            `\r⏳ [Nodes] Đã quét: ${nodesRead.toLocaleString()} nodes | Đã lưu: ${totalSaved.toLocaleString()} địa điểm | RAM: ${memMb} MB`
          );
        }
      }

      isFlushing = false;
    }

    osm2.on('data', (items: any[]) => {
      itemQueue.push(items);
      processQueue();
    });

    osm2.on('end', async () => {
      // Wait for any remaining items in queue
      while (itemQueue.length > 0 || isFlushing) {
        await new Promise((r) => setTimeout(r, 50));
      }
      // Flush remaining node POIs
      if (batchBuffer.length > 0) {
        const saved = await flushBatch(batchBuffer, fileName);
        totalSaved += saved;
        namedNodesSaved += saved;
      }
      resolve();
    });

    osm2.on('error', (err: any) => reject(err));
    stream2.on('error', (err: any) => reject(err));
    stream2.pipe(osm2);
  });

  // Free neededNodeIds set from memory now that we have packedCoords
  neededNodeIds.clear();

  console.log(`\n\n✅ Đã nạp thành công ${namedNodesSaved.toLocaleString()} POI và địa danh dạng Node vào Postgres!`);
  console.log(`🔄 Tọa độ sẵn sàng: ${packedCoords.size.toLocaleString()} nodes. Bắt đầu dựng hình học Ways & Ranh giới...`);

  // -------------------------------------------------------------------------
  // PASS 3: Dựng hình học và nạp Ways (Tòa nhà, Phường, Xã, Ranh giới)
  // -------------------------------------------------------------------------
  const wayRings = new Map<number, number[][]>();
  let waysSaved = 0;

  for (const [wayId, way] of pendingWays.entries()) {
    const ring: number[][] = [];
    for (const ref of way.refs) {
      const packed = packedCoords.get(ref);
      if (packed !== undefined) {
        ring.push(unpackCoord(packed));
      }
    }

    if (ring.length < 3) continue;

    // Auto-close polygon ring
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
      Number(((bbox.minLon + bbox.maxLon) / 2).toFixed(6)),
      Number(((bbox.minLat + bbox.maxLat) / 2).toFixed(6)),
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
      waysSaved += saved;
      const memMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      process.stdout.write(`\r💾 [Ways] Đã lưu vào Postgres: ${totalSaved.toLocaleString()} địa điểm | RAM: ${memMb} MB`);
    }
  }

  // Flush remaining ways
  if (batchBuffer.length > 0) {
    const saved = await flushBatch(batchBuffer, fileName);
    totalSaved += saved;
    waysSaved += saved;
  }

  // Free pendingWays map to release memory before relations
  pendingWays.clear();

  console.log(`\n✅ Đã lưu ${waysSaved.toLocaleString()} công trình / ranh giới dạng Way vào Postgres!`);
  console.log(`🔄 Đang lắp ghép ${pendingRelations.length.toLocaleString()} Relations (Cấp tỉnh, quận, huyện, xã, phường)...`);

  // -------------------------------------------------------------------------
  // PASS 4: Lắp ghép và nạp Relations (Đa giác Multipolygon hành chính)
  // -------------------------------------------------------------------------
  let relsSaved = 0;

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
        Number(((bbox.minLon + bbox.maxLon) / 2).toFixed(6)),
        Number(((bbox.minLat + bbox.maxLat) / 2).toFixed(6)),
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
        relsSaved += saved;
      }
    }
  }

  // Flush remaining relations
  if (batchBuffer.length > 0) {
    const saved = await flushBatch(batchBuffer, fileName);
    totalSaved += saved;
    relsSaved += saved;
  }

  // Record audit log
  await db.insert(importLogs).values({
    filename: fileName,
    placesCount: totalSaved,
    fileSize: stat.size,
    status: 'success',
  });

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n================================================================');
  console.log(`🎉 HOÀN TẤT IMPORT DỮ LIỆU TOÀN DIỆN VÀO GOOGLE CLOUD SQL POSTGRESQL!`);
  console.log(`⏱️ Tổng thời gian: ${durationSec}s`);
  console.log(`📍 Tổng số thực thể đã lưu vào PostgreSQL: ${totalSaved.toLocaleString()}`);
  console.log(`   - Địa danh & POI (Nodes): ${namedNodesSaved.toLocaleString()}`);
  console.log(`   - Công trình & Ranh giới (Ways): ${waysSaved.toLocaleString()}`);
  console.log(`   - Ranh giới Hành chính (Relations): ${relsSaved.toLocaleString()}`);
  console.log(`🏠 Dữ liệu đã lưu bền vững tại bảng 'osm_places' trên Cloud SQL.`);
  console.log('================================================================');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Lỗi trong quá trình import PBF:', err);
  process.exit(1);
});
