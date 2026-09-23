import { pgTable, serial, text, integer, bigint, doublePrecision, jsonb, timestamp } from 'drizzle-orm/pg-core';

// Users table (required for Firebase Auth integration)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// OSM Places table: stores administrative boundaries, buildings, and POIs
export const osmPlaces = pgTable('osm_places', {
  id: text('id').primaryKey(), // e.g. "rel/12345", "way/6789", "node/9988"
  osmId: bigint('osm_id', { mode: 'number' }).notNull(),
  osmType: text('osm_type').notNull(), // 'relation' | 'way' | 'node'
  name: text('name').notNull(),
  nameVi: text('name_vi'),
  nameEn: text('name_en'),
  adminLevel: text('admin_level').notNull(),
  adminLevelLabel: text('admin_level_label').notNull(),
  priorityRank: integer('priority_rank').notNull(),
  placeType: text('place_type').notNull(),
  tags: jsonb('tags').notNull(),
  minLon: doublePrecision('min_lon').notNull(),
  minLat: doublePrecision('min_lat').notNull(),
  maxLon: doublePrecision('max_lon').notNull(),
  maxLat: doublePrecision('max_lat').notNull(),
  centerLon: doublePrecision('center_lon').notNull(),
  centerLat: doublePrecision('center_lat').notNull(),
  geometryType: text('geometry_type').notNull(), // 'Polygon' | 'MultiPolygon' | 'Point'
  geometry: jsonb('geometry').notNull(),
  areaApproxKm2: doublePrecision('area_approx_km2'),
  source: text('source').default('import'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Import audit log
export const importLogs = pgTable('import_logs', {
  id: serial('id').primaryKey(),
  filename: text('filename').notNull(),
  placesCount: integer('places_count').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }),
  status: text('status').default('success'),
  createdAt: timestamp('created_at').defaultNow(),
});
