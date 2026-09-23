export interface OSMTags {
  [key: string]: string;
}

export type AdminLevel = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 'poi' | 'building' | 'street';

export interface GeoPolygon {
  // GeoJSON Polygon coordinates: array of rings, each ring is array of [lon, lat]
  // Outer ring is coordinates[0], holes are coordinates[1..n]
  coordinates: number[][][];
}

export interface GeoMultiPolygon {
  // Array of Polygons
  coordinates: number[][][][];
}

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface OSMPlace {
  id: string; // e.g. "rel/12345" or "node/67890" or "way/11223"
  osmId: number;
  osmType: 'relation' | 'way' | 'node';
  name: string;
  nameVi?: string;
  nameEn?: string;
  adminLevel: number | string; // 2, 3, 4, 6, 8, etc. or 'poi'
  adminLevelLabel: string; // e.g. "Quốc gia", "Tỉnh / Thành phố", "Quận / Huyện", "Phường / Xã", "Địa điểm"
  priorityRank: number; // lower number = more specific (1 = POI, 2 = Street, 3 = Ward, 4 = District, 5 = Province, 6 = Region, 7 = Country)
  placeType: 'country' | 'region' | 'province' | 'district' | 'ward' | 'subward' | 'street' | 'poi' | 'building';
  tags: OSMTags;
  bbox: BoundingBox;
  center: [number, number]; // [lon, lat]
  // Geometry for point-in-polygon checks and map rendering
  geometryType: 'Polygon' | 'MultiPolygon' | 'Point';
  geometry: GeoPolygon | GeoMultiPolygon | { coordinates: [number, number] };
  areaApproxKm2?: number;
  isContained?: boolean; // true if query coordinate is strictly inside polygon geometry
  distanceMeters?: number; // distance in meters if point POI
}

export interface ReverseGeocodeResult {
  query: {
    lat: number;
    lon: number;
    order: 'narrow_to_broad' | 'broad_to_narrow';
  };
  totalFound: number;
  totalContained: number;
  totalNearby: number;
  hierarchy: {
    building?: OSMPlace;
    country?: OSMPlace;
    region?: OSMPlace;
    province?: OSMPlace;
    district?: OSMPlace;
    ward?: OSMPlace;
    poi?: OSMPlace;
  };
  fullPath: string[]; // e.g. ["Tòa nhà Landmark 81", "Phường 22", "Quận Bình Thạnh", "Thành phố Hồ Chí Minh", "Việt Nam"]
  places: OSMPlace[]; // strictly containing places (isContained === true)
  nearbyPois: OSMPlace[]; // nearby POIs (sorted by distance)
  allMatches?: OSMPlace[]; // all items
  executionTimeMs: number;
}

export interface PBFProcessingLog {
  id: string;
  level: 'error' | 'warning' | 'info';
  timestamp: string;
  category:
    | 'protobuf_stream'
    | 'geometry_build'
    | 'node_resolution'
    | 'attribute_missing'
    | 'memory_limit'
    | 'file_validation';
  message: string;
  details?: string;
  itemId?: string;
}

export interface PBFParseStats {
  totalEntitiesRead: number;
  nodesCount: number;
  waysCount: number;
  relationsCount: number;
  adminBoundariesBuilt: number;
  buildingsBuilt: number;
  poisBuilt: number;
  skippedWaysCount: number;
  unresolvedNodesCount: number;
  errorCount: number;
  warningCount: number;
  durationMs: number;
  logs: PBFProcessingLog[];
}

export interface DatabaseStatus {
  connected: boolean;
  totalPlaces: number;
  recentImports?: any[];
}

export interface DatasetStatus {
  sourceName: string;
  sourceType: 'default_vietnam' | 'uploaded_pbf' | 'postgres';
  fileSizeBytes?: number;
  uploadedAt: string;
  stats: {
    totalEntities: number;
    buildings: number;
    countries: number;
    provinces: number;
    districts: number;
    wards: number;
    pois: number;
  };
  sampleCoordinates: Array<{
    name: string;
    lat: number;
    lon: number;
    description: string;
  }>;
  lastParseStats?: PBFParseStats;
  database?: DatabaseStatus;
}

export interface BuildingSelectionRequest {
  coordinates: [number, number][];
}

export interface SelectedBuildingPlace extends OSMPlace {
  coverageRatio: number;
}

export interface BuildingSelectionData {
  places: SelectedBuildingPlace[];
}

export interface BuildingSelectionResult {
  success: boolean;
  data?: BuildingSelectionData;
  error?: string;
}
