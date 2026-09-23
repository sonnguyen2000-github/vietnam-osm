export interface OSMTags {
  [key: string]: string;
}

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface OSMPlace {
  id: string;
  osmId: number;
  osmType: 'relation' | 'way' | 'node';
  name: string;
  nameVi?: string;
  nameEn?: string;
  adminLevel: number | string;
  adminLevelLabel: string;
  priorityRank: number;
  placeType: 'country' | 'region' | 'province' | 'district' | 'ward' | 'subward' | 'street' | 'poi' | 'building';
  tags: OSMTags;
  bbox: BoundingBox;
  center: [number, number];
  geometryType: 'Polygon' | 'MultiPolygon' | 'Point';
  geometry: {
    coordinates: any;
  };
  areaApproxKm2?: number;
  isContained?: boolean;
  distanceMeters?: number;
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
  fullPath: string[];
  places: OSMPlace[];
  nearbyPois: OSMPlace[];
  allMatches?: OSMPlace[];
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
