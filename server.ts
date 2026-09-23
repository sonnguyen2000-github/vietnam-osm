import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { SpatialIndex } from './server/spatialIndex';
import { getDefaultVietnamPlaces } from './server/defaultData';
import { parsePBFFile } from './server/pbfParser';
import { parseOSMXmlFile } from './server/osmXmlParser';
import { DatasetStatus, PBFParseStats, OSMPlace } from './server/types';
import {
  getStoredPlacesCount,
  getPlacesByBbox,
  savePlacesToDb,
  getDbStats,
} from './src/db/osmPlaces.ts';

const app = express();
const PORT = 3000;

// Middleware for JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Setup multer for PBF and OSM XML file uploads
const uploadDir = path.join(os.tmpdir(), 'osm-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB limit
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (
      name.endsWith('.pbf') ||
      name.endsWith('.osm.pbf') ||
      name.endsWith('.osm') ||
      file.mimetype === 'application/octet-stream' ||
      file.mimetype === 'application/x-protobuf' ||
      file.mimetype === 'application/xml' ||
      file.mimetype === 'text/xml'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file định dạng .osm, .pbf hoặc .osm.pbf'));
    }
  },
});

const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per chunk limit
});

// Initialize Spatial Index with default Vietnam places
const defaultPlaces = getDefaultVietnamPlaces();
const spatialIndex = new SpatialIndex();

let datasetStatus: DatasetStatus = {
  sourceName: 'Vietnam Administrative Hierarchy (Default Dataset)',
  sourceType: 'default_vietnam',
  uploadedAt: new Date().toISOString(),
  stats: {
    totalEntities: defaultPlaces.length,
    buildings: defaultPlaces.filter((p) => p.placeType === 'building' || p.adminLevel === 'building').length,
    countries: defaultPlaces.filter((p) => p.adminLevel === 2).length,
    provinces: defaultPlaces.filter((p) => p.adminLevel === 4).length,
    districts: defaultPlaces.filter((p) => p.adminLevel === 6).length,
    wards: defaultPlaces.filter((p) => p.adminLevel === 8).length,
    pois: defaultPlaces.filter((p) => p.adminLevel === 'poi' || p.placeType === 'poi').length,
  },
  sampleCoordinates: [
    {
      name: 'Tòa nhà Landmark 81 (TP. HCM)',
      lat: 10.795,
      lon: 106.7218,
      description: 'Ranh giới tòa nhà 81 tầng, Phường 22, Quận Bình Thạnh, TP.HCM',
    },
    {
      name: 'Tòa nhà Keangnam 72 (Hà Nội)',
      lat: 21.0169,
      lon: 105.7838,
      description: 'Ranh giới tháp văn phòng Keangnam 72, Phường Mễ Trì, Quận Nam Từ Liêm',
    },
    {
      name: 'Nhà Hát Lớn Hà Nội',
      lat: 21.0244,
      lon: 105.8576,
      description: 'Ranh giới công trình Số 1 Tràng Tiền, Quận Hoàn Kiếm, TP. Hà Nội',
    },
    {
      name: 'Số 12 Phố Tràng Tiền (Hà Nội)',
      lat: 21.0255,
      lon: 105.854,
      description: 'Ranh giới nhà phố thương mại số 12 Tràng Tiền, Quận Hoàn Kiếm',
    },
    {
      name: 'Tòa nhà Bitexco Financial (TP. HCM)',
      lat: 10.7716,
      lon: 106.7042,
      description: 'Ranh giới tòa nhà Bitexco 68 tầng, Phường Bến Nghé, Quận 1',
    },
    {
      name: 'Dinh Độc Lập (TP. HCM)',
      lat: 10.777,
      lon: 106.6953,
      description: 'Ranh giới Hội trường Thống Nhất, 135 Nam Kỳ Khởi Nghĩa, Quận 1',
    },
    {
      name: 'TT Hành chính TP. Đà Nẵng',
      lat: 16.0748,
      lon: 108.2235,
      description: 'Ranh giới tòa nhà hành chính 37 tầng, 24 Trần Phú, Quận Hải Châu',
    },
    {
      name: 'Hồ Gươm (Hà Nội)',
      lat: 21.0287,
      lon: 105.8524,
      description: 'Phường Hàng Trống, Quận Hoàn Kiếm, TP. Hà Nội',
    },
    {
      name: 'Chợ Bến Thành (TP. HCM)',
      lat: 10.7725,
      lon: 106.6983,
      description: 'Phường Bến Thành, Quận 1, TP. Hồ Chí Minh',
    },
    {
      name: 'Cầu Rồng (Đà Nẵng)',
      lat: 16.061,
      lon: 108.2274,
      description: 'Phường Phước Ninh, Quận Hải Châu, TP. Đà Nẵng',
    },
  ],
};

function updateDatasetStats() {
  const currentPlaces = spatialIndex.getPlaces();
  datasetStatus.stats = {
    totalEntities: currentPlaces.length,
    buildings: currentPlaces.filter((p) => p.placeType === 'building' || p.adminLevel === 'building').length,
    countries: currentPlaces.filter((p) => p.adminLevel === 2).length,
    provinces: currentPlaces.filter((p) => p.adminLevel === 4).length,
    districts: currentPlaces.filter((p) => p.adminLevel === 6).length,
    wards: currentPlaces.filter((p) => p.adminLevel === 8).length,
    pois: currentPlaces.filter((p) => p.adminLevel === 'poi' || p.placeType === 'poi').length,
  };
}

// ==========================================
// REST API ROUTES
// ==========================================

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'OSM Vietnam Hierarchy & Reverse Geocoder',
    version: '1.0.0',
    indexedPlaces: 0,
    storageMode: 'postgres_viewport_query',
  });
});

// Current dataset status and metadata
app.get('/api/status', async (_req, res) => {
  const dbStats = await getDbStats();
  datasetStatus.database = dbStats;
  if (dbStats.connected) {
    datasetStatus.stats.totalEntities = dbStats.totalPlaces;
    datasetStatus.sourceName = 'PostgreSQL Database (viewport queries)';
    datasetStatus.sourceType = 'postgres';
  }
  res.json({ success: true, data: datasetStatus });
});

async function getLookupCandidates(lat: number, lon: number, nearbyMeters: number, buildingMeters: number) {
  const metersToLat = (meters: number) => meters / 111139;
  const metersToLon = (meters: number) => meters / (111139 * Math.max(Math.cos(lat * Math.PI / 180), 0.1));

  // This query cannot be truncated by the density of surrounding buildings: every
  // polygon whose bbox contains the exact point is always checked geometrically.
  const containingBbox = getPlacesByBbox({
    minLon: lon, minLat: lat, maxLon: lon, maxLat: lat, limit: 10000,
  });

  const nearbyRadius = Math.max(nearbyMeters, 1);
  const nearby = getPlacesByBbox({
    minLon: lon - metersToLon(nearbyRadius), minLat: lat - metersToLat(nearbyRadius),
    maxLon: lon + metersToLon(nearbyRadius), maxLat: lat + metersToLat(nearbyRadius),
    adminLevels: ['poi'], limit: 2000, orderFrom: { lon, lat },
  });

  const buildingRadius = Math.max(buildingMeters, 1);
  const buildings = getPlacesByBbox({
    minLon: lon - metersToLon(buildingRadius), minLat: lat - metersToLat(buildingRadius),
    maxLon: lon + metersToLon(buildingRadius), maxLat: lat + metersToLat(buildingRadius),
    adminLevels: ['building'], limit: 3000, orderFrom: { lon, lat },
  });

  const groups = await Promise.all([containingBbox, nearby, buildings]);
  return [...new Map(groups.flat().map((place) => [place.id, place])).values()];
}

// PRIMARY ENDPOINT: Coordinate Reverse Geocoding & Administrative Hierarchy Lookup
// GET /api/lookup?lat=10.7725&lon=106.6983&order=narrow_to_broad
app.get('/api/lookup', async (req, res) => {
  const latStr = (req.query.lat as string) || '';
  const lonStr = (req.query.lon || req.query.lng) as string || '';
  const order =
    req.query.order === 'broad_to_narrow' ? 'broad_to_narrow' : 'narrow_to_broad';
  const maxDistance = req.query.max_distance ? parseInt(req.query.max_distance as string, 10) : 150;
  const includeNearby = req.query.include_nearby !== 'false';
  const onlyContaining = req.query.only_containing === 'true';
  const fallbackBuilding = req.query.fallback_nearest_building !== 'false';
  const maxBuildingDist = req.query.max_building_distance ? parseInt(req.query.max_building_distance as string, 10) : 2000;

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({
      success: false,
      error: 'Vui lòng cung cấp toạ độ hợp lệ qua tham số `lat` và `lon` (hoặc `lng`). Ví dụ: /api/lookup?lat=21.0285&lon=105.8542',
    });
    return;
  }

  // Validate bounds roughly for Vietnam / world
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({
      success: false,
      error: 'Toạ độ nằm ngoài giới hạn hợp lệ (-90 <= lat <= 90, -180 <= lon <= 180)',
    });
    return;
  }

  try {
    const candidates = await getLookupCandidates(
      lat, lon, isNaN(maxDistance) ? 150 : maxDistance, isNaN(maxBuildingDist) ? 2000 : maxBuildingDist
    );
    const result = new SpatialIndex(candidates).query(lat, lon, order, isNaN(maxDistance) ? 150 : maxDistance,
      !onlyContaining && includeNearby, fallbackBuilding, isNaN(maxBuildingDist) ? 2000 : maxBuildingDist);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(503).json({ success: false, error: `Không thể truy vấn PostgreSQL: ${error.message}` });
  }
});

// POST /api/lookup
// Body: { lat: 21.0287, lon: 105.8524, order?: "narrow_to_broad" | "broad_to_narrow", include_nearby?: boolean, max_distance?: number, fallback_nearest_building?: boolean, max_building_distance?: number }
app.post('/api/lookup', async (req, res) => {
  const { lat, lon, lng, order, max_distance, include_nearby, only_containing, fallback_nearest_building, max_building_distance } = req.body;
  const targetLon = lon !== undefined ? lon : lng;

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(targetLon);

  if (isNaN(latNum) || isNaN(lonNum)) {
    res.status(400).json({
      success: false,
      error: 'Vui lòng cung cấp body JSON hợp lệ dạng { "lat": number, "lon": number }',
    });
    return;
  }

  const sortOrder = order === 'broad_to_narrow' ? 'broad_to_narrow' : 'narrow_to_broad';
  const maxDistance = max_distance !== undefined ? parseInt(max_distance, 10) : 150;
  const maxBuildingDist = max_building_distance !== undefined ? parseInt(max_building_distance, 10) : 2000;
  const incNearby = only_containing ? false : include_nearby !== false;
  const fallbackBuilding = fallback_nearest_building !== false;

  try {
    const candidates = await getLookupCandidates(
      latNum, lonNum, isNaN(maxDistance) ? 150 : maxDistance, isNaN(maxBuildingDist) ? 2000 : maxBuildingDist
    );
    const result = new SpatialIndex(candidates).query(latNum, lonNum, sortOrder, isNaN(maxDistance) ? 150 : maxDistance,
      incNearby, fallbackBuilding, isNaN(maxBuildingDist) ? 2000 : maxBuildingDist);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(503).json({ success: false, error: `Không thể truy vấn PostgreSQL: ${error.message}` });
  }
});

// GET /api/layers - Export GeoJSON features of all indexed places for map visualization
app.get('/api/layers', async (req, res) => {
  const minLon = Number(req.query.min_lon), minLat = Number(req.query.min_lat);
  const maxLon = Number(req.query.max_lon), maxLat = Number(req.query.max_lat);
  const zoom = Math.max(0, Math.min(20, Number(req.query.zoom)));
  if (![minLon, minLat, maxLon, maxLat, zoom].every(Number.isFinite) || minLon >= maxLon || minLat >= maxLat) {
    return res.status(400).json({ success: false, error: 'Cần bbox hợp lệ: min_lon, min_lat, max_lon, max_lat và zoom.' });
  }
  const adminLevels = zoom < 7 ? ['2', '3', '4'] : zoom < 10 ? ['4', '5', '6']
    : zoom < 14 ? ['6', '7', '8'] : zoom < 16 ? ['8', '9', '10', 'street']
    : ['8', '9', '10', 'street', 'building', 'poi'];
  try {
    const places = await getPlacesByBbox({ minLon, minLat, maxLon, maxLat, adminLevels, limit: zoom >= 16 ? 8000 : 4000 });
    res.set('Cache-Control', 'private, max-age=15');
    res.json({ type: 'FeatureCollection', zoom, count: places.length, features: places.map((place) => ({
      type: 'Feature', properties: { ...place, geometry: undefined },
      geometry: { type: place.geometryType, coordinates: place.geometry.coordinates },
    })) });
  } catch (error: any) {
    res.status(503).json({ success: false, error: `Không thể truy vấn PostgreSQL: ${error.message}` });
  }
});

function mergeUploadedPlacesWithAdminHierarchy(
  uploadedPlaces: OSMPlace[],
  originalName: string,
  fileSize: number,
  stats: PBFParseStats
): DatasetStatus {
  const uploadedCountries = uploadedPlaces.filter((p) => p.adminLevel === 2).length;
  const uploadedProvinces = uploadedPlaces.filter((p) => p.adminLevel === 4).length;
  const uploadedDistricts = uploadedPlaces.filter((p) => p.adminLevel === 6).length;
  const uploadedWards = uploadedPlaces.filter((p) => p.adminLevel === 8).length;

  // Combine places: keep all uploaded places
  const combinedPlaces = [...uploadedPlaces];

  // If the uploaded file is specialized (e.g. buildings or POIs only without enclosing admin boundaries),
  // retain administrative boundary polygons so reverse geocoding can resolve the full hierarchy
  if (uploadedCountries === 0) {
    combinedPlaces.push(...defaultPlaces.filter((p) => p.adminLevel === 2));
  }
  if (uploadedProvinces === 0) {
    combinedPlaces.push(...defaultPlaces.filter((p) => p.adminLevel === 4 || p.adminLevel === 3));
  }
  if (uploadedDistricts === 0) {
    combinedPlaces.push(...defaultPlaces.filter((p) => p.adminLevel === 6));
  }
  if (uploadedWards === 0) {
    combinedPlaces.push(...defaultPlaces.filter((p) => p.adminLevel === 8));
  }


  // Persist imported places asynchronously to PostgreSQL for durable storage across restarts
  savePlacesToDb(combinedPlaces, 'import', originalName, fileSize)
    .then(async (res) => {
      console.log(`[Postgres] Đã lưu bền vững ${res.saved} địa điểm từ file "${originalName}" vào PostgreSQL.`);
      const dbStats = await getDbStats();
      datasetStatus.database = dbStats;
    })
    .catch((err) => {
      console.error('[Postgres] Lỗi khi lưu dữ liệu import vào database:', err);
    });

  datasetStatus = {
    sourceName: originalName,
    sourceType: 'uploaded_pbf',
    fileSizeBytes: fileSize,
    uploadedAt: new Date().toISOString(),
    stats: {
      totalEntities: combinedPlaces.length,
      buildings: combinedPlaces.filter((p) => p.placeType === 'building' || p.adminLevel === 'building').length,
      countries: combinedPlaces.filter((p) => p.adminLevel === 2).length,
      provinces: combinedPlaces.filter((p) => p.adminLevel === 4).length,
      districts: combinedPlaces.filter((p) => p.adminLevel === 6).length,
      wards: combinedPlaces.filter((p) => p.adminLevel === 8).length,
      pois: combinedPlaces.filter((p) => p.adminLevel === 'poi' || p.placeType === 'poi').length,
    },
    sampleCoordinates: datasetStatus.sampleCoordinates,
    lastParseStats: stats,
    database: datasetStatus.database,
  };

  return datasetStatus;
}

// POST /api/upload-pbf or /api/upload-osm - Upload and parse .osm, .pbf or .osm.pbf file
app.post(['/api/upload-pbf', '/api/upload-osm'], (req, res) => {
  upload.single('file')(req, res, async (uploadErr: any) => {
    if (uploadErr) {
      console.error('Multer file upload error:', uploadErr);
      let errorMsg = uploadErr.message || 'Lỗi khi tải file PBF lên máy chủ';
      let details = uploadErr.stack || 'Lỗi middleware tải file multipart/form-data';

      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        errorMsg = 'Dung lượng file vượt quá giới hạn cho phép (1 GB).';
        details = 'File PBF của bạn quá lớn đối với một phiên tải trực tiếp. Vui lòng nạp bản trích xuất theo thành phố hoặc dùng osmium lọc riêng ranh giới hành chính.';
      }

      const errorLog: PBFParseStats = {
        totalEntitiesRead: 0,
        nodesCount: 0,
        waysCount: 0,
        relationsCount: 0,
        adminBoundariesBuilt: 0,
        buildingsBuilt: 0,
        poisBuilt: 0,
        skippedWaysCount: 0,
        unresolvedNodesCount: 0,
        errorCount: 1,
        warningCount: 0,
        durationMs: 0,
        logs: [
          {
            id: `err-upload-${Date.now()}`,
            level: 'error',
            timestamp: new Date().toLocaleTimeString('vi-VN'),
            category: 'file_validation',
            message: errorMsg,
            details,
          },
        ],
      };
      datasetStatus.lastParseStats = errorLog;

      return res.status(400).json({
        success: false,
        error: errorMsg,
        stats: errorLog,
        dataset: datasetStatus,
      });
    }

    if (!req.file) {
      const errorMsg = 'Không tìm thấy file tải lên. Vui lòng gửi trường multipart/form-data `file` với file .pbf hoặc .osm.pbf';
      const errorLog: PBFParseStats = {
        totalEntitiesRead: 0,
        nodesCount: 0,
        waysCount: 0,
        relationsCount: 0,
        adminBoundariesBuilt: 0,
        buildingsBuilt: 0,
        poisBuilt: 0,
        skippedWaysCount: 0,
        unresolvedNodesCount: 0,
        errorCount: 1,
        warningCount: 0,
        durationMs: 0,
        logs: [
          {
            id: `err-missing-${Date.now()}`,
            level: 'error',
            timestamp: new Date().toLocaleTimeString('vi-VN'),
            category: 'file_validation',
            message: errorMsg,
            details: 'Request không đính kèm file trong trường `file`.',
          },
        ],
      };
      datasetStatus.lastParseStats = errorLog;

      return res.status(400).json({
        success: false,
        error: errorMsg,
        stats: errorLog,
        dataset: datasetStatus,
      });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const fileSize = req.file.size;
    const isOsmXml = originalName.toLowerCase().endsWith('.osm');

    try {
      const { places, stats } = isOsmXml
        ? await parseOSMXmlFile(filePath)
        : await parsePBFFile(filePath);
      datasetStatus.lastParseStats = stats;

      // Merge or replace: if user uploaded, replace active dataset or merge with defaults
      if (places.length > 0) {
        const updatedDataset = mergeUploadedPlacesWithAdminHierarchy(
          places,
          originalName,
          fileSize,
          stats
        );

        res.json({
          success: true,
          message: `Đã xử lý thành công file ${isOsmXml ? 'OSM XML' : 'OSM PBF'} "${originalName}"!`,
          stats,
          totalIndexed: updatedDataset.stats.totalEntities,
          dataset: updatedDataset,
        });
      } else {
        res.status(400).json({
          success: false,
          error: `Không tìm thấy ranh giới hành chính hoặc địa điểm hợp lệ trong file ${isOsmXml ? '.osm' : '.pbf'} này. Dữ liệu mặc định vẫn được giữ nguyên.`,
          stats,
          dataset: datasetStatus,
        });
      }
    } catch (error: any) {
      console.error('Error parsing OSM file:', error);
      const errorLog: PBFParseStats = {
        totalEntitiesRead: 0,
        nodesCount: 0,
        waysCount: 0,
        relationsCount: 0,
        adminBoundariesBuilt: 0,
        buildingsBuilt: 0,
        poisBuilt: 0,
        skippedWaysCount: 0,
        unresolvedNodesCount: 0,
        errorCount: 1,
        warningCount: 0,
        durationMs: 0,
        logs: [
          {
            id: `err-${Date.now()}`,
            level: 'error',
            timestamp: new Date().toLocaleTimeString('vi-VN'),
            category: isOsmXml ? 'geometry_build' : 'protobuf_stream',
            message: `Lỗi xử lý file "${originalName}": ${error.message || 'Lỗi cấu trúc hoặc định dạng không hợp lệ'}`,
            details: error.stack || 'File có thể bị nén lỗi, không đúng chuẩn OSM XML / PBF hoặc bị gián đoạn khi truyền tải.',
          },
        ],
      };
      datasetStatus.lastParseStats = errorLog;

      res.status(500).json({
        success: false,
        error: `Lỗi khi phân tích file: ${error.message || 'Lỗi không xác định'}`,
        stats: errorLog,
        dataset: datasetStatus,
      });
    } finally {
      // Clean up temporary file
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.warn('Failed to delete temp file:', e);
      }
    }
  });
});

// POST /api/upload-chunk - Chunked upload to bypass Cloud Run 32MB single payload limit and iframe restrictions
app.post('/api/upload-chunk', chunkUpload.single('chunk'), async (req, res) => {
  try {
    const { fileId, fileName, chunkIndex, totalChunks } = req.body;
    const chunkNum = parseInt(chunkIndex, 10);
    const total = parseInt(totalChunks, 10);

    if (!req.file || !fileId || isNaN(chunkNum) || isNaN(total)) {
      return res.status(400).json({
        success: false,
        error: 'Thiếu thông tin chunk, fileId hoặc tổng số mảnh tải lên',
      });
    }

    const safeFileId = String(fileId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const tempFilePath = path.join(uploadDir, `chunk_${safeFileId}.tmp`);

    // If first chunk and file exists, start clean
    if (chunkNum === 0 && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {}
    }

    // Append chunk buffer to temp file
    fs.appendFileSync(tempFilePath, req.file.buffer);

    // If there are more chunks remaining
    if (chunkNum + 1 < total) {
      return res.json({
        success: true,
        completed: false,
        chunkIndex: chunkNum,
        totalChunks: total,
        progress: Math.round(((chunkNum + 1) / total) * 100),
      });
    }

    // All chunks received! Assemble and parse final PBF or OSM XML file
    const originalName = String(fileName || 'vietnam.osm');
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalFilePath = path.join(uploadDir, `${Date.now()}-${sanitizedName}`);

    fs.renameSync(tempFilePath, finalFilePath);
    const fileSize = fs.statSync(finalFilePath).size;
    const isOsmXml = originalName.toLowerCase().endsWith('.osm');

    try {
      const { places, stats } = isOsmXml
        ? await parseOSMXmlFile(finalFilePath)
        : await parsePBFFile(finalFilePath);
      datasetStatus.lastParseStats = stats;

      if (places.length > 0) {
        const updatedDataset = mergeUploadedPlacesWithAdminHierarchy(
          places,
          originalName,
          fileSize,
          stats
        );

        return res.json({
          success: true,
          completed: true,
          message: `Đã nạp thành công file ${isOsmXml ? 'OSM XML' : 'OSM PBF'} "${originalName}" (${(fileSize / (1024 * 1024)).toFixed(1)} MB)!`,
          stats,
          totalIndexed: updatedDataset.stats.totalEntities,
          dataset: updatedDataset,
        });
      } else {
        return res.status(400).json({
          success: false,
          completed: true,
          error: `Không tìm thấy ranh giới hành chính hoặc công trình hợp lệ trong file ${isOsmXml ? '.osm' : '.pbf'} này. Dữ liệu mặc định vẫn được giữ nguyên.`,
          stats,
          dataset: datasetStatus,
        });
      }
    } finally {
      try {
        if (fs.existsSync(finalFilePath)) {
          fs.unlinkSync(finalFilePath);
        }
      } catch (e) {
        console.warn('Failed to delete temp file:', e);
      }
    }
  } catch (err: any) {
    console.error('Error handling chunk upload:', err);
    return res.status(500).json({
      success: false,
      error: `Lỗi xử lý file tải lên: ${err.message || err.toString()}`,
    });
  }
});

// POST /api/reset-default - Reset to default Vietnam dataset
app.post('/api/reset-default', (_req, res) => {
  const freshPlaces = getDefaultVietnamPlaces();
  datasetStatus = {
    sourceName: 'Vietnam Administrative Hierarchy (Default Dataset)',
    sourceType: 'default_vietnam',
    uploadedAt: new Date().toISOString(),
    stats: {
      totalEntities: freshPlaces.length,
      buildings: freshPlaces.filter((p) => p.placeType === 'building' || p.adminLevel === 'building').length,
      countries: freshPlaces.filter((p) => p.adminLevel === 2).length,
      provinces: freshPlaces.filter((p) => p.adminLevel === 4).length,
      districts: freshPlaces.filter((p) => p.adminLevel === 6).length,
      wards: freshPlaces.filter((p) => p.adminLevel === 8).length,
      pois: freshPlaces.filter((p) => p.adminLevel === 'poi' || p.placeType === 'poi').length,
    },
    sampleCoordinates: datasetStatus.sampleCoordinates,
  };

  res.json({
    success: true,
    message: 'Đã đặt lại dữ liệu về bộ phân cấp hành chính Việt Nam mặc định.',
    dataset: datasetStatus,
  });
});

// GET /api/pbf-logs - Retrieve current or latest PBF processing logs
app.get('/api/pbf-logs', (_req, res) => {
  res.json({
    success: true,
    lastParseStats: datasetStatus.lastParseStats || null,
  });
});

// POST /api/simulate-pbf-error - Simulate sample PBF parsing diagnostics and errors for UI demonstration
app.post('/api/simulate-pbf-error', (_req, res) => {
  const simulatedStats: PBFParseStats = {
    totalEntitiesRead: 45280,
    nodesCount: 38200,
    waysCount: 6850,
    relationsCount: 230,
    adminBoundariesBuilt: 34,
    buildingsBuilt: 248,
    poisBuilt: 112,
    skippedWaysCount: 28,
    unresolvedNodesCount: 142,
    errorCount: 2,
    warningCount: 4,
    durationMs: 1420,
    logs: [
      {
        id: `sim-${Date.now()}-1`,
        level: 'info',
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        category: 'file_validation',
        message: 'Khởi tạo luồng giải mã: vietnam-extract-hanoi.osm.pbf (Dung lượng: 48.65 MB).',
      },
      {
        id: `sim-${Date.now()}-2`,
        level: 'warning',
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        category: 'geometry_build',
        message: 'Bỏ qua Way #4892182 ("Đường ranh giới Phường Yên Phụ"): Chỉ tìm thấy 2/38 node tham chiếu.',
        details: 'Các node biên nằm ngoài vùng trích xuất bounding-box của file PBF. Cần dùng Osmconvert hoặc Osmium với cờ --complete-ways để giữ lại đầy đủ toạ độ đa giác.',
        itemId: 'way/4892182',
      },
      {
        id: `sim-${Date.now()}-3`,
        level: 'warning',
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        category: 'attribute_missing',
        message: 'Quan hệ ranh giới Relation #9823120 có boundary=administrative nhưng thiếu thẻ "admin_level".',
        details: 'Hệ thống tự động suy luận cấp hành chính dựa trên thẻ place=suburb hoặc phân loại địa danh liên quan.',
        itemId: 'rel/9823120',
      },
      {
        id: `sim-${Date.now()}-4`,
        level: 'warning',
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        category: 'node_resolution',
        message: 'Node #8421021 có toạ độ bất thường [105.85, 95.21] vượt ngưỡng vĩ độ hợp lệ [-90, 90].',
        details: 'Node bị loại bỏ để tránh làm sai lệch phép tính Bounding Box không gian.',
        itemId: 'node/8421021',
      },
      {
        id: `sim-${Date.now()}-5`,
        level: 'error',
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        category: 'geometry_build',
        message: 'Lỗi đa giác tự cắt chéo (Self-intersecting ring) tại Way #1920391 ("Khu dân cư ven sông").',
        details: 'Mặt phẳng đa giác có các cạnh giao nhau không hợp lệ theo chuẩn OGC Simple Features, không thể kiểm tra Point-in-Polygon an toàn.',
        itemId: 'way/1920391',
      },
      {
        id: `sim-${Date.now()}-6`,
        level: 'error',
        timestamp: new Date().toLocaleTimeString('vi-VN'),
        category: 'protobuf_stream',
        message: 'Cảnh báo khối nén Zlib Block #42 gặp lỗi Checksum CRC không khớp trong một số khối phụ.',
        details: 'Stream parser đã bỏ qua khối bị hỏng và tiếp tục đọc các khối kế tiếp.',
      },
    ],
  };

  datasetStatus.lastParseStats = simulatedStats;

  res.json({
    success: true,
    message: 'Đã tạo nhật ký chẩn đoán lỗi phân tích file PBF mẫu thành công!',
    stats: simulatedStats,
  });
});

// POST /api/import-pbf-url or /api/import-osm-url - Download PBF or OSM XML directly on server from URL
app.post(['/api/import-pbf-url', '/api/import-osm-url'], async (req, res) => {
  const { url, name } = req.body;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({
      success: false,
      error: 'Vui lòng cung cấp URL hợp lệ (bắt đầu bằng http:// hoặc https://) trỏ tới file .osm hoặc .osm.pbf',
    });
  }

  const isOsmXml = (url.split('?')[0].toLowerCase().endsWith('.osm') || (name && name.toLowerCase().endsWith('.osm')));
  const tempFileName = `url-import-${Date.now()}.${isOsmXml ? 'osm' : 'osm.pbf'}`;
  const tempFilePath = path.join(uploadDir, tempFileName);
  const displayName = name || url.split('/').pop() || (isOsmXml ? 'downloaded.osm' : 'downloaded.osm.pbf');

  try {
    console.log(`Starting server-side download of OSM data: ${url}`);
    const downloadRes = await fetch(url);
    if (!downloadRes.ok) {
      throw new Error(`Tải file từ URL thất bại (HTTP ${downloadRes.status}: ${downloadRes.statusText})`);
    }

    if (!downloadRes.body) {
      throw new Error('Dữ liệu tải về từ URL rỗng.');
    }

    // Stream to file
    const fileStream = fs.createWriteStream(tempFilePath);
    // Node.js 18+ web stream to node stream
    // @ts-ignore
    const { Readable } = await import('stream');
    // @ts-ignore
    const readable = Readable.fromWeb(downloadRes.body);
    await new Promise<void>((resolve, reject) => {
      readable.pipe(fileStream);
      readable.on('error', reject);
      fileStream.on('finish', () => resolve());
      fileStream.on('error', reject);
    });

    const fileStats = fs.statSync(tempFilePath);
    console.log(`Downloaded ${displayName} (${fileStats.size} bytes). Parsing...`);

    const { places, stats } = isOsmXml
      ? await parseOSMXmlFile(tempFilePath)
      : await parsePBFFile(tempFilePath);
    datasetStatus.lastParseStats = stats;

    if (places.length > 0) {

      // Persist downloaded places to PostgreSQL
      savePlacesToDb(places, 'url_import', displayName, fileStats.size)
        .then(async (res) => {
          console.log(`[Postgres] Đã lưu ${res.saved} địa điểm từ URL "${displayName}" vào PostgreSQL.`);
          const dbStats = await getDbStats();
          datasetStatus.database = dbStats;
        })
        .catch((err) => {
          console.error('[Postgres] Lỗi lưu URL import vào database:', err);
        });

      datasetStatus = {
        sourceName: displayName,
        sourceType: 'uploaded_pbf',
        fileSizeBytes: fileStats.size,
        uploadedAt: new Date().toISOString(),
        stats: {
          totalEntities: places.length,
          buildings: places.filter((p) => p.placeType === 'building' || p.adminLevel === 'building').length,
          countries: places.filter((p) => p.adminLevel === 2).length,
          provinces: places.filter((p) => p.adminLevel === 4).length,
          districts: places.filter((p) => p.adminLevel === 6).length,
          wards: places.filter((p) => p.adminLevel === 8).length,
          pois: places.filter((p) => p.adminLevel === 'poi' || p.placeType === 'poi').length,
        },
        sampleCoordinates: datasetStatus.sampleCoordinates,
        lastParseStats: stats,
        database: datasetStatus.database,
      };

      res.json({
        success: true,
        message: `Đã tải và lập chỉ mục thành công "${displayName}"!`,
        stats,
        totalIndexed: places.length,
        dataset: datasetStatus,
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Không tìm thấy ranh giới hành chính hợp lệ trong file PBF tải về.',
        stats,
        dataset: datasetStatus,
      });
    }
  } catch (error: any) {
    console.error('Error importing PBF from URL:', error);
    const errorLog: PBFParseStats = {
      totalEntitiesRead: 0,
      nodesCount: 0,
      waysCount: 0,
      relationsCount: 0,
      adminBoundariesBuilt: 0,
      buildingsBuilt: 0,
      poisBuilt: 0,
      skippedWaysCount: 0,
      unresolvedNodesCount: 0,
      errorCount: 1,
      warningCount: 0,
      durationMs: 0,
      logs: [
        {
          id: `err-url-${Date.now()}`,
          level: 'error',
          timestamp: new Date().toLocaleTimeString('vi-VN'),
          category: 'protobuf_stream',
          message: `Lỗi tải/phân tích URL "${displayName}": ${error.message}`,
          details: error.stack || 'Không thể tải hoặc xử lý file từ đường dẫn trực tiếp.',
        },
      ],
    };
    datasetStatus.lastParseStats = errorLog;

    res.status(500).json({
      success: false,
      error: error.message || 'Lỗi xử lý file PBF từ URL',
      stats: errorLog,
      dataset: datasetStatus,
    });
  } finally {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (e) {
      console.warn('Failed to delete temp URL file:', e);
    }
  }
});

// GET /api/database/status - Retrieve Postgres database sync status
app.get('/api/database/status', async (_req, res) => {
  try {
    const stats = await getDbStats();
    res.json({
      success: true,
      data: stats,
      inMemoryIndexed: 0,
      queryMode: 'viewport',
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Lỗi kiểm tra cơ sở dữ liệu',
    });
  }
});

// POST /api/database/reload - Refresh metadata only; map data remains request-scoped.
app.post('/api/database/reload', async (_req, res) => {
  try {
    const dbStats = await getDbStats();
    if (!dbStats.connected || dbStats.totalPlaces === 0) {
      return res.status(400).json({ success: false, error: 'Database chưa có địa điểm nào được lưu.' });
    }
    spatialIndex.clear();
    datasetStatus.sourceName = 'PostgreSQL Database (viewport queries)';
    datasetStatus.sourceType = 'postgres';
    datasetStatus.uploadedAt = new Date().toISOString();
    datasetStatus.stats.totalEntities = dbStats.totalPlaces;
    datasetStatus.database = dbStats;
    res.json({ success: true, message: 'Đã làm mới kết nối PostgreSQL; dữ liệu sẽ được truy vấn theo khung bản đồ.', dataset: datasetStatus });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Lỗi khi làm mới PostgreSQL' });
  }
});

// Global Error Handler to guarantee JSON responses
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Lỗi hệ thống nội bộ',
  });
});

// Initialize Database and Places on startup
async function initDatabaseAndPlaces() {
  try {
    const stats = await getDbStats();
    datasetStatus.database = stats;
    if (stats.connected && stats.totalPlaces > 0) {
      datasetStatus.sourceName = 'PostgreSQL Database (viewport queries)';
      datasetStatus.sourceType = 'postgres';
      datasetStatus.stats.totalEntities = stats.totalPlaces;
      console.log(`[Postgres] Sẵn sàng truy vấn theo viewport: ${stats.totalPlaces} địa điểm (không preload RAM).`);
    } else if (stats.connected) {
      await savePlacesToDb(defaultPlaces, 'default_seed', 'vietnam_default_dataset.json');
      datasetStatus.database = await getDbStats();
    }
  } catch (err) {
    console.warn('[Postgres] Khởi tạo Postgres hoãn lại hoặc chưa sẵn sàng:', err);
  }
}

// ==========================================
// VITE / STATIC SERVING
// ==========================================
async function startServer() {
  // Boot Database synchronization first
  await initDatabaseAndPlaces();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vietnam OSM Hierarchy Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
