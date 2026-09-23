import fs from 'fs';
// @ts-ignore - osm-pbf-parser does not have typescript declarations by default
import parseOSM from 'osm-pbf-parser';
import { GeoMultiPolygon, GeoPolygon, OSMPlace, OSMTags, PBFParseStats, PBFProcessingLog } from './types';
import { computeBoundingBox } from './spatialIndex';

/**
 * Determine administrative level label and priority
 */
export function getAdminMeta(tags: OSMTags): {
  adminLevel: number | string;
  adminLevelLabel: string;
  priorityRank: number;
  placeType: OSMPlace['placeType'];
} {
  const adminLevelStr = tags.admin_level || tags['border_type'];

  if (adminLevelStr === '2') {
    return {
      adminLevel: 2,
      adminLevelLabel: 'Quốc gia (Country)',
      priorityRank: 7,
      placeType: 'country',
    };
  }
  if (adminLevelStr === '3') {
    return {
      adminLevel: 3,
      adminLevelLabel: 'Vùng địa lý / Kinh tế (Region)',
      priorityRank: 6,
      placeType: 'region',
    };
  }
  if (adminLevelStr === '4') {
    return {
      adminLevel: 4,
      adminLevelLabel: 'Tỉnh / Thành phố trực thuộc TW (Province)',
      priorityRank: 5,
      placeType: 'province',
    };
  }
  if (adminLevelStr === '6') {
    return {
      adminLevel: 6,
      adminLevelLabel: 'Quận / Huyện / Thị xã (District)',
      priorityRank: 4,
      placeType: 'district',
    };
  }
  if (adminLevelStr === '7') {
    return {
      adminLevel: 7,
      adminLevelLabel: 'Thị xã / Phường đặc thù',
      priorityRank: 3.5,
      placeType: 'district',
    };
  }
  if (adminLevelStr === '8') {
    return {
      adminLevel: 8,
      adminLevelLabel: 'Phường / Xã / Thị trấn (Ward/Commune)',
      priorityRank: 3,
      placeType: 'ward',
    };
  }
  if (adminLevelStr === '9' || adminLevelStr === '10') {
    return {
      adminLevel: Number(adminLevelStr),
      adminLevelLabel: 'Tổ dân phố / Thôn / Xóm / Bản',
      priorityRank: 2,
      placeType: 'subward',
    };
  }

  // Non-admin places / POIs
  if (tags.place === 'city' || tags.place === 'province') {
    return {
      adminLevel: 4,
      adminLevelLabel: 'Thành phố / Tỉnh',
      priorityRank: 5,
      placeType: 'province',
    };
  }
  if (tags.place === 'town' || tags.place === 'district' || tags.place === 'county') {
    return {
      adminLevel: 6,
      adminLevelLabel: 'Quận / Huyện / Thị trấn',
      priorityRank: 4,
      placeType: 'district',
    };
  }
  if (tags.place === 'village' || tags.place === 'suburb' || tags.place === 'neighbourhood') {
    return {
      adminLevel: 8,
      adminLevelLabel: 'Phường / Xã / Làng',
      priorityRank: 3,
      placeType: 'ward',
    };
  }

  // 1. Building boundaries (Top Priority for exact spatial footprint match)
  if (tags.building && tags.building !== 'no') {
    let buildingLabel = 'Ranh giới Nhà cửa / Tòa nhà';
    const bType = tags.building.toLowerCase();
    if (bType === 'apartments') buildingLabel = 'Chung cư / Căn hộ (Apartments)';
    else if (bType === 'residential' || bType === 'house' || bType === 'detached') buildingLabel = 'Nhà ở / Nhà riêng (Residential)';
    else if (bType === 'commercial' || bType === 'office') buildingLabel = 'Tòa nhà văn phòng / Thương mại';
    else if (bType === 'retail' || bType === 'supermarket') buildingLabel = 'Khu thương mại / Cửa hàng';
    else if (bType === 'hospital' || bType === 'clinic') buildingLabel = 'Cơ sở Y tế / Bệnh viện';
    else if (bType === 'school' || bType === 'university') buildingLabel = 'Cơ sở Giáo dục / Trường học';
    else if (bType === 'hotel') buildingLabel = 'Khách sạn (Hotel)';
    else if (bType === 'industrial') buildingLabel = 'Khu công nghiệp / Nhà xưởng';
    else if (bType === 'skyscraper') buildingLabel = 'Tòa nhà cao tầng (Skyscraper)';
    else if (bType !== 'yes') buildingLabel = `Công trình (${tags.building})`;

    return {
      adminLevel: 'building',
      adminLevelLabel: buildingLabel,
      priorityRank: 0.5, // Lowest rank number = tightest precision, first in hierarchy
      placeType: 'building',
    };
  }

  // 2. POI / Non-building amenities
  return {
    adminLevel: 'poi',
    adminLevelLabel: tags.amenity
      ? `Tiện ích (${tags.amenity})`
      : tags.tourism
      ? `Điểm du lịch (${tags.tourism})`
      : 'Địa điểm / Điểm quan tâm',
    priorityRank: 1,
    placeType: 'poi',
  };
}

/**
 * Intelligently format building names using name, address, or amenity tags
 */
export function formatBuildingName(tags: OSMTags, fallbackId: string | number): string {
  if (tags.name) return tags.name;
  if (tags['name:vi']) return tags['name:vi'];
  if (tags['name:en']) return tags['name:en'];

  const houseNum = tags['addr:housenumber'];
  const street = tags['addr:street'];
  if (houseNum && street) {
    return `Số ${houseNum} ${street}`;
  }
  if (houseNum) {
    return `Nhà số ${houseNum}`;
  }
  if (street) {
    return `Nhà mặt tiền ${street}`;
  }
  if (tags.amenity) {
    return `Tòa nhà tiện ích (${tags.amenity})`;
  }
  if (tags.shop) {
    return `Tòa nhà kinh doanh (${tags.shop})`;
  }
  if (tags.building && tags.building !== 'yes') {
    return `Khối nhà (${tags.building}) #${fallbackId}`;
  }
  return `Ranh giới nhà #${fallbackId}`;
}

/**
 * Stream and parse an uploaded OSM PBF file to extract administrative boundaries and POIs
 * with comprehensive error & warning tracking.
 */
export async function parsePBFFile(
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
    // Keep max 200 logs to avoid bloating response
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
      throw new Error('File PBF rỗng (0 bytes). Vui lòng kiểm tra lại file của bạn.');
    }
    addLog(
      'info',
      'file_validation',
      `Khởi tạo luồng giải nén PBF: ${(stat.size / (1024 * 1024)).toFixed(2)} MB.`
    );
  } catch (err: any) {
    addLog('error', 'file_validation', `Không thể truy cập file PBF: ${err.message}`);
    throw err;
  }

  // Temporary storage to resolve coordinates
  // Store node coordinates in Map - 3.5M entries take ~300MB heap, safely within 3.1GB limit
  const nodeCoords = new Map<number, [number, number]>(); // nodeId -> [lon, lat]
  const pendingWays = new Map<number, { id: number; refs: number[]; tags: OSMTags }>();
  const pendingRelations: Array<{
    id: number;
    tags: OSMTags;
    members: Array<{ type: string; id: number; role?: string }>;
  }> = [];

  let totalEntitiesRead = 0;
  let nodesCount = 0;
  let waysCount = 0;
  let relationsCount = 0;
  let skippedWaysCount = 0;
  let unresolvedNodesCount = 0;

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    const osm = parseOSM();

    stream.on('error', (err) => {
      addLog(
        'error',
        'protobuf_stream',
        `Lỗi đọc luồng file (Stream I/O Error): ${err.message}`,
        err.stack
      );
      reject(err);
    });

    osm.on('error', (err: any) => {
      const msg = err.message || 'Lỗi cấu trúc dữ liệu protobuf';
      addLog(
        'error',
        'protobuf_stream',
        `Lỗi giải mã nhị phân OSM PBF: ${msg}. File có thể bị hỏng hoặc không đúng chuẩn OSM Protocolbuffer.`,
        err.stack
      );
      reject(err);
    });

    osm.on('data', (items: any[]) => {
      for (const item of items) {
        totalEntitiesRead++;

        const tags = item.tags || {};
        const name = tags.name || tags['name:vi'] || tags['name:en'];

        if (item.type === 'node') {
          nodesCount++;
          if (item.lat !== undefined && item.lon !== undefined) {
            // Check coordinate boundaries
            if (item.lat < -90 || item.lat > 90 || item.lon < -180 || item.lon > 180) {
              continue;
            }

            // Cache node coordinates for building geometry polygons (up to 3.5 million nodes)
            if (nodeCoords.size < 3500000) {
              nodeCoords.set(item.id, [item.lon, item.lat]);
            }

            // If named place or POI (and within reasonable limit)
            if (
              places.length < maxPlacesToExtract &&
              name &&
              (tags.place ||
                tags.amenity ||
                tags.tourism ||
                tags.historic ||
                tags.leisure ||
                tags.shop)
            ) {
              const meta = getAdminMeta(tags);
              places.push({
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
                  minLon: item.lon - 0.001,
                  maxLon: item.lon + 0.001,
                  minLat: item.lat - 0.001,
                  maxLat: item.lat + 0.001,
                },
                center: [item.lon, item.lat],
                geometryType: 'Point',
                geometry: {
                  coordinates: [item.lon, item.lat],
                },
              });
            }
          }
        } else if (item.type === 'way') {
          waysCount++;
          const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
          const isPlace = tags.place !== undefined;
          const isBuilding = tags.building !== undefined && tags.building !== 'no';
          const isLeisure = tags.leisure !== undefined;
          const isPoi = tags.amenity !== undefined || tags.tourism !== undefined || tags.shop !== undefined;

          // Check if way has empty refs
          if (!item.refs || item.refs.length === 0) {
            continue;
          }

          // Store candidate ways for geometry construction (up to 150,000 ways)
          if (isBoundary || isPlace || isBuilding || isLeisure || isPoi || name) {
            if (pendingWays.size < 150000) {
              pendingWays.set(item.id, {
                id: item.id,
                refs: item.refs || [],
                tags,
              });
            }
          }
        } else if (item.type === 'relation') {
          relationsCount++;
          const isBoundary = tags.boundary === 'administrative' || tags.admin_level !== undefined;
          const isBuilding = tags.building !== undefined && tags.building !== 'no';
          const isTypeBoundary = tags.type === 'boundary' || tags.type === 'multipolygon';

          if ((isBoundary || isTypeBoundary || isBuilding) && item.members && item.members.length > 0) {
            if (pendingRelations.length < 2000) {
              pendingRelations.push({
                id: item.id,
                tags,
                members: item.members,
              });
            }
          }
        }
      }
    });

    osm.on('end', () => {
      let adminBoundariesBuilt = 0;
      let buildingsBuilt = 0;
      let poisBuilt = 0;

      addLog(
        'info',
        'geometry_build',
        `Hoàn tất quét toàn bộ luồng OSM PBF: ${nodesCount.toLocaleString()} nodes, ${waysCount.toLocaleString()} ways, ${relationsCount.toLocaleString()} relations. Bắt đầu dựng hình học không gian...`
      );

      // Map to store constructed way rings so relations can reuse them
      const wayRings = new Map<number, number[][]>();

      // 1. Post-process ways that can be resolved into closed polygons
      for (const [wayId, way] of pendingWays) {
        if (!way.refs || way.refs.length === 0) {
          skippedWaysCount++;
          continue;
        }

        // Resolve coordinates
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

        // Check if way cannot form polygon
        if (ring.length < 3) {
          skippedWaysCount++;
          continue;
        }

        // Auto-close ring if slightly open
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([...first]);
        }

        // Save ring for relation assembly
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
          });
        }
      }

      // 2. Assemble Relation-based Administrative Boundaries (Multipolygon / Boundary Relations)
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
            geometry,
          });
        }
      }

      // 3. Clear temporary coordinate maps immediately to free RAM
      nodeCoords.clear();
      pendingWays.clear();
      wayRings.clear();
      pendingRelations.length = 0;

      // Filter valid places
      const validPlaces = places.filter(
        (p) =>
          p.geometryType === 'Point' ||
          (p.geometryType === 'Polygon' &&
            (p.geometry as any).coordinates &&
            (p.geometry as any).coordinates.length > 0) ||
          (p.geometryType === 'MultiPolygon' &&
            (p.geometry as any).coordinates &&
            (p.geometry as any).coordinates.length > 0)
      );

      const errorCount = logs.filter((l) => l.level === 'error').length;
      const warningCount = logs.filter((l) => l.level === 'warning').length;

      if (validPlaces.length === 0) {
        addLog(
          'error',
          'geometry_build',
          'Không trích xuất được bất kỳ đối tượng ranh giới hoặc địa điểm hợp lệ nào từ file PBF này.',
          'Hãy đảm bảo file PBF chứa các đối tượng có thẻ building=*, boundary=administrative hoặc place/amenity.'
        );
      } else {
        addLog(
          'info',
          'geometry_build',
          `Hoàn tất lập chỉ mục thành công ${validPlaces.length.toLocaleString()} đối tượng (${buildingsBuilt.toLocaleString()} ranh giới nhà cửa/công trình, ${adminBoundariesBuilt.toLocaleString()} ranh giới hành chính, ${poisBuilt.toLocaleString()} điểm tiện ích).`
        );
      }

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
        errorCount,
        warningCount,
        durationMs: Date.now() - startTime,
        logs,
      };

      resolve({ places: validPlaces, stats });
    });

    stream.pipe(osm);
  });
}
