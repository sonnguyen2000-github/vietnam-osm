import fs from 'fs';
import sax from 'sax';
import {
  GeoMultiPolygon,
  GeoPolygon,
  OSMPlace,
  OSMTags,
  PBFParseStats,
  PBFProcessingLog,
} from './types';
import { computeBoundingBox } from './spatialIndex';
import { getAdminMeta, formatBuildingName } from './pbfParser';

function calculateApproxAreaKm2(rings: number[][][]): number {
  if (!rings || rings.length === 0 || !rings[0] || rings[0].length < 3) return 0;
  const ring = rings[0];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    area += (p2[0] - p1[0]) * (p2[1] + p1[1]);
  }
  // 1 deg lat ~ 111 km, 1 deg lon ~ 106 km in Vietnam
  return Math.abs(area / 2) * 111 * 106;
}

/**
 * Stream and parse an uploaded OSM XML (.osm) file to extract administrative boundaries,
 * building footprints, and POIs with comprehensive error & warning tracking.
 */
export async function parseOSMXmlFile(
  filePath: string,
  maxPlacesToExtract = 120000
): Promise<{ places: OSMPlace[]; stats: PBFParseStats }> {
  const startTime = Date.now();
  const places: OSMPlace[] = [];
  const logs: PBFProcessingLog[] = [];

  const addLog = (
    level: 'error' | 'warning' | 'info',
    category: PBFProcessingLog['category'],
    message: string,
    details?: string,
    itemId?: string
  ) => {
    if (logs.length < 200) {
      logs.push({
        id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        level,
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        category,
        message,
        details,
        itemId,
      });
    }
  };

  // Pre-check file size and existence
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      addLog('error', 'file_validation', 'File tải lên có kích thước 0 byte (file rỗng).');
      throw new Error('File OSM XML rỗng (0 bytes). Vui lòng kiểm tra lại file của bạn.');
    }
    addLog(
      'info',
      'file_validation',
      `Khởi tạo luồng phân tích cú pháp OSM XML (.osm): ${(stat.size / (1024 * 1024)).toFixed(2)} MB.`
    );
  } catch (err: any) {
    addLog('error', 'file_validation', `Không thể truy cập file OSM XML: ${err.message}`);
    throw err;
  }

  // Temporary storage to resolve coordinates
  const nodeCoords = new Map<number, [number, number]>(); // nodeId -> [lon, lat]

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

  let totalEntitiesRead = 0;
  let nodesCount = 0;
  let waysCount = 0;
  let relationsCount = 0;
  let skippedWaysCount = 0;
  let unresolvedNodesCount = 0;

  // Active element tracking while parsing XML tree
  let currentNode: { id: number; lat: number; lon: number; tags: OSMTags } | null = null;
  let currentWay: { id: number; refs: number[]; tags: OSMTags } | null = null;
  let currentRelation: {
    id: number;
    members: Array<{ type: string; id: number; role: string }>;
    tags: OSMTags;
  } | null = null;

  return new Promise<{ places: OSMPlace[]; stats: PBFParseStats }>((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const saxStream = sax.createStream(true, { trim: true });

    saxStream.on('error', (err: any) => {
      const msg = err.message || 'Lỗi cú pháp XML';
      addLog(
        'error',
        'protobuf_stream',
        `Lỗi đọc định dạng OSM XML: ${msg}. File có thể bị hỏng hoặc cấu trúc XML không đúng chuẩn OpenStreetMap.`,
        err.stack
      );
      // sax will continue unless fileStream is destroyed
      fileStream.destroy();
      reject(err);
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
          if (currentNode) {
            currentNode.tags[k] = v;
          } else if (currentWay) {
            currentWay.tags[k] = v;
          } else if (currentRelation) {
            currentRelation.tags[k] = v;
          }
        }
      } else if (tagName === 'nd') {
        if (currentWay && attrs.ref) {
          const ref = parseInt(attrs.ref, 10);
          if (!isNaN(ref)) {
            currentWay.refs.push(ref);
          }
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

    saxStream.on('closetag', (tagName: string) => {
      if (tagName === 'node' && currentNode) {
        nodesCount++;
        totalEntitiesRead++;

        const { id, lat, lon, tags } = currentNode;
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          if (nodeCoords.size < 3500000) {
            nodeCoords.set(id, [lon, lat]);
          }

          const name = tags.name || tags['name:vi'] || tags['name:en'];
          if (
            places.length < maxPlacesToExtract &&
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
            places.push({
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
              geometry: {
                coordinates: [lon, lat],
              },
            });
          }
        }
        currentNode = null;
      } else if (tagName === 'way' && currentWay) {
        waysCount++;
        totalEntitiesRead++;

        const { id, refs, tags } = currentWay;
        const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
        const isPlace = tags.place !== undefined;
        const isBuilding = tags.building !== undefined && tags.building !== 'no';
        const isLeisure = tags.leisure !== undefined;
        const isPoi =
          tags.amenity !== undefined || tags.tourism !== undefined || tags.shop !== undefined;
        const name = tags.name || tags['name:vi'] || tags['name:en'];

        if (refs.length > 0 && (isBoundary || isPlace || isBuilding || isLeisure || isPoi || name)) {
          if (pendingWays.size < 200000) {
            pendingWays.set(id, { id, refs, tags });
          }
        }
        currentWay = null;
      } else if (tagName === 'relation' && currentRelation) {
        relationsCount++;
        totalEntitiesRead++;

        const { id, members, tags } = currentRelation;
        const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
        const isBuilding = tags.building !== undefined && tags.building !== 'no';
        const isTypeBoundary = tags.type === 'boundary' || tags.type === 'multipolygon';

        if ((isBoundary || isTypeBoundary || isBuilding) && members.length > 0) {
          if (pendingRelations.length < 5000) {
            pendingRelations.push({ id, members, tags });
          }
        }
        currentRelation = null;
      }
    });

    saxStream.on('end', () => {
      let adminBoundariesBuilt = 0;
      let buildingsBuilt = 0;
      let poisBuilt = 0;

      addLog(
        'info',
        'geometry_build',
        `Hoàn tất quét toàn bộ file OSM XML: ${nodesCount.toLocaleString()} nodes, ${waysCount.toLocaleString()} ways, ${relationsCount.toLocaleString()} relations. Bắt đầu dựng hình học không gian...`
      );

      const wayRings = new Map<number, number[][]>();

      // 1. Post-process ways into polygons
      for (const [wayId, way] of pendingWays) {
        if (!way.refs || way.refs.length === 0) {
          skippedWaysCount++;
          continue;
        }

        const ring: number[][] = [];
        let missingNodesForThisWay = 0;

        for (const ref of way.refs) {
          const coord = nodeCoords.get(ref);
          if (coord) {
            ring.push(coord);
          } else {
            missingNodesForThisWay++;
          }
        }

        unresolvedNodesCount += missingNodesForThisWay;

        if (ring.length < 3) {
          skippedWaysCount++;
          continue;
        }

        // Auto-close ring if open
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([...first]);
        }

        wayRings.set(wayId, ring);

        const tags = way.tags;
        const isClosedInOsm = way.refs.length >= 4 && way.refs[0] === way.refs[way.refs.length - 1];
        const isLinearFeature =
          (tags.highway !== undefined ||
            tags.railway !== undefined ||
            tags.waterway !== undefined ||
            tags.barrier !== undefined) &&
          tags.area !== 'yes';
        const isBuilding = tags.building !== undefined && tags.building !== 'no';
        const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
        const isAreaFeature =
          isBuilding ||
          isBoundary ||
          tags.landuse !== undefined ||
          tags.leisure !== undefined ||
          tags.amenity !== undefined ||
          tags.area === 'yes';

        // Do NOT convert linear roads/railways or open lines into artificial polygon places
        if (!isClosedInOsm || isLinearFeature || !isAreaFeature) {
          continue;
        }

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

        if (tags.boundary === 'administrative' || tags.admin_level) {
          adminBoundariesBuilt++;
        } else if (meta.placeType === 'building') {
          buildingsBuilt++;
        } else {
          poisBuilt++;
        }

        if (places.length < maxPlacesToExtract) {
          places.push({
            id: `way/${wayId}`,
            osmId: wayId,
            osmType: 'way',
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
            geometryType: 'Polygon',
            geometry: {
              coordinates: [ring],
            },
            areaApproxKm2: calculateApproxAreaKm2([ring]),
          });
        }
      }

      // 2. Assemble Relation-based Boundaries
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
          let name = tags.name || tags['name:vi'] || tags['name:en'] || `Relation #${rel.id}`;
          const meta = getAdminMeta(tags);
          const bbox = computeBoundingBox(outerRings);
          const center: [number, number] = [
            (bbox.minLon + bbox.maxLon) / 2,
            (bbox.minLat + bbox.maxLat) / 2,
          ];

          adminBoundariesBuilt++;

          const isSingle = outerRings.length === 1;
          const geometry: GeoPolygon | GeoMultiPolygon = isSingle
            ? { coordinates: [outerRings[0]] }
            : { coordinates: outerRings.map((r) => [r]) };

          places.push({
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
            geometry: geometry as any,
            areaApproxKm2: outerRings.reduce((sum, r) => sum + calculateApproxAreaKm2([r]), 0),
          });
        }
      }

      // Clean up caches
      nodeCoords.clear();
      pendingWays.clear();
      pendingRelations.length = 0;
      wayRings.clear();

      const durationMs = Date.now() - startTime;

      addLog(
        'info',
        'geometry_build',
        `Hoàn tất dựng hình học OSM XML thành công! Trích xuất ${places.length.toLocaleString()} địa điểm/công trình (${adminBoundariesBuilt.toLocaleString()} ranh giới, ${buildingsBuilt.toLocaleString()} nhà cửa, ${poisBuilt.toLocaleString()} POIs) trong ${(durationMs / 1000).toFixed(1)} giây.`
      );

      const stats: PBFParseStats = {
        totalEntitiesRead,
        nodesCount,
        waysCount,
        relationsCount,
        adminBoundariesBuilt,
        buildingsBuilt,
        poisBuilt,
        skippedWaysCount,
        unresolvedNodesCount,
        errorCount: logs.filter((l) => l.level === 'error').length,
        warningCount: logs.filter((l) => l.level === 'warning').length,
        durationMs,
        logs,
      };

      resolve({ places, stats });
    });

    fileStream.pipe(saxStream);
  });
}
