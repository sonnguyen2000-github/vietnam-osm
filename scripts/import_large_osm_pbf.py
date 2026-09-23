#!/usr/bin/env python3
"""
Python Script: Import large OSM PBF (.osm.pbf) directly into PostgreSQL database.
Uses `osmium` (C++ high-performance streaming parser) and psycopg2 execute_values for maximum throughput.

Requirements:
    pip install osmium psycopg2-binary

Usage:
    export DATABASE_URL="postgresql://user:password@host:port/dbname"
    python3 scripts/import_large_osm_pbf.py /path/to/vietnam-latest.osm.pbf [batch_size]

Example:
    python3 scripts/import_large_osm_pbf.py ./vietnam-latest.osm.pbf 500
"""

import sys
import os
import json
import time
import psycopg2
from psycopg2.extras import execute_values
try:
    import osmium
except ImportError:
    print("❌ Thư viện 'osmium' chưa được cài đặt. Vui lòng chạy: pip install osmium psycopg2-binary")
    sys.exit(1)

# Vietnam approximate Bounding Box filter
VN_BBOX = {
    'min_lon': 102.0,
    'max_lon': 110.5,
    'min_lat': 8.0,
    'max_lat': 24.0,
}

def get_admin_meta(tags):
    admin_level_raw = tags.get('admin_level')
    place = tags.get('place')
    building = tags.get('building')

    if admin_level_raw:
        try:
            lvl = int(admin_level_raw)
            if lvl == 2:
                return 2, 'Quốc gia (Country)', 7, 'country'
            elif lvl == 3:
                return 3, 'Vùng địa lý (Region)', 6, 'region'
            elif lvl == 4:
                return 4, 'Tỉnh / Thành phố trực thuộc TW', 5, 'province'
            elif lvl == 6:
                return 6, 'Quận / Huyện / Thị xã', 4, 'district'
            elif lvl == 8:
                return 8, 'Phường / Xã / Thị trấn', 3, 'ward'
            else:
                return lvl, f'Cấp hành chính {lvl}', 2, 'subdistrict'
        except ValueError:
            pass

    if building and building != 'no':
        return 'building', 'Tòa nhà / Công trình (Building)', 0, 'building'

    if place == 'country':
        return 2, 'Quốc gia', 7, 'country'
    elif place in ('state', 'province'):
        return 4, 'Tỉnh / Thành phố', 5, 'province'
    elif place in ('city', 'county', 'district'):
        return 6, 'Quận / Huyện', 4, 'district'
    elif place in ('town', 'village', 'suburb', 'quarter'):
        return 8, 'Phường / Xã', 3, 'ward'

    return 'poi', 'Địa điểm / Tiện ích (POI)', 0, 'poi'

def compute_bounding_box(coords):
    min_lon = min(p[0] for p in coords)
    max_lon = max(p[0] for p in coords)
    min_lat = min(p[1] for p in coords)
    max_lat = max(p[1] for p in coords)
    return min_lon, min_lat, max_lon, max_lat

def calculate_approx_area_km2(coords):
    if len(coords) < 3:
        return 0.0
    area = 0.0
    for i in range(len(coords) - 1):
        p1 = coords[i]
        p2 = coords[i + 1]
        area += (p2[0] - p1[0]) * (p2[1] + p1[1])
    return abs(area / 2.0) * 111.0 * 106.0

def flush_batch(cursor, batch, source_name):
    if not batch:
        return 0

    query = """
    INSERT INTO osm_places (
        id, osm_id, osm_type, name, name_vi, name_en,
        admin_level, admin_level_label, priority_rank, place_type,
        tags, min_lon, min_lat, max_lon, max_lat,
        center_lon, center_lat, geometry_type, geometry,
        area_approx_km2, source
    ) VALUES %s
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        name_vi = EXCLUDED.name_vi,
        name_en = EXCLUDED.name_en,
        tags = EXCLUDED.tags,
        min_lon = EXCLUDED.min_lon,
        min_lat = EXCLUDED.min_lat,
        max_lon = EXCLUDED.max_lon,
        max_lat = EXCLUDED.max_lat,
        center_lon = EXCLUDED.center_lon,
        center_lat = EXCLUDED.center_lat,
        geometry_type = EXCLUDED.geometry_type,
        geometry = EXCLUDED.geometry,
        area_approx_km2 = EXCLUDED.area_approx_km2,
        source = EXCLUDED.source;
    """

    records = []
    for item in batch:
        records.append((
            item['id'],
            item['osm_id'],
            item['osm_type'],
            item['name'],
            item.get('name_vi'),
            item.get('name_en'),
            str(item['admin_level']),
            item['admin_level_label'],
            item['priority_rank'],
            item['place_type'],
            json.dumps(item['tags']),
            item['min_lon'],
            item['min_lat'],
            item['max_lon'],
            item['max_lat'],
            item['center_lon'],
            item['center_lat'],
            item['geometry_type'],
            json.dumps(item['geometry']),
            item.get('area_approx_km2'),
            source_name
        ))

    execute_values(cursor, query, records)
    count = len(batch)
    batch.clear()
    return count

class OSMHandler(osmium.SimpleHandler):
    def __init__(self, cursor, file_name, batch_size=500):
        super(OSMHandler, self).__init__()
        self.cursor = cursor
        self.file_name = file_name
        self.batch_size = batch_size
        self.batch_buffer = []
        self.total_saved = 0
        self.node_coords = {}
        self.pending_ways = {}
        self.nodes_count = 0
        self.ways_count = 0
        self.last_print = time.time()

    def node(self, n):
        self.nodes_count += 1
        if not n.location.valid():
            return
        lon = n.location.lon
        lat = n.location.lat

        if not (VN_BBOX['min_lat'] <= lat <= VN_BBOX['max_lat'] and VN_BBOX['min_lon'] <= lon <= VN_BBOX['max_lon']):
            return

        self.node_coords[n.id] = (lon, lat)

        tags = {t.k: t.v for t in n.tags}
        name = tags.get('name') or tags.get('name:vi') or tags.get('name:en')
        if name and (tags.get('place') or tags.get('amenity') or tags.get('tourism') or
                     tags.get('historic') or tags.get('leisure') or tags.get('shop')):
            admin_lvl, admin_lbl, rank, p_type = get_admin_meta(tags)
            self.batch_buffer.append({
                'id': f'node/{n.id}',
                'osm_id': n.id,
                'osm_type': 'node',
                'name': name,
                'name_vi': tags.get('name:vi', name),
                'name_en': tags.get('name:en', ''),
                'admin_level': admin_lvl,
                'admin_level_label': admin_lbl,
                'priority_rank': rank,
                'place_type': p_type,
                'tags': tags,
                'min_lon': lon - 0.001,
                'max_lon': lon + 0.001,
                'min_lat': lat - 0.001,
                'max_lat': lat + 0.001,
                'center_lon': lon,
                'center_lat': lat,
                'geometry_type': 'Point',
                'geometry': {'coordinates': [lon, lat]},
                'area_approx_km2': 0.01
            })

            if len(self.batch_buffer) >= self.batch_size:
                self.total_saved += flush_batch(self.cursor, self.batch_buffer, self.file_name)

        now = time.time()
        if now - self.last_print > 3:
            self.last_print = now
            print(f"\r⏳ Tiến trình đọc PBF: {self.nodes_count:,} nodes | Đã lưu: {self.total_saved:,}", end='', flush=True)

    def way(self, w):
        self.ways_count += 1
        tags = {t.k: t.v for t in w.tags}
        is_bldg = bool(tags.get('building') and tags.get('building') != 'no')
        is_bndry = bool(tags.get('boundary') == 'administrative' or tags.get('admin_level'))

        if (is_bldg or is_bndry) and len(w.nodes) >= 3:
            refs = [n.ref for n in w.nodes]
            coords = [self.node_coords[r] for r in refs if r in self.node_coords]
            if len(coords) < 3:
                return

            if coords[0] != coords[-1]:
                coords.append(coords[0])

            min_lon, min_lat, max_lon, max_lat = compute_bounding_box(coords)
            center_lon = (min_lon + max_lon) / 2.0
            center_lat = (min_lat + max_lat) / 2.0
            area = calculate_approx_area_km2(coords)

            admin_lvl, admin_lbl, rank, p_type = get_admin_meta(tags)
            name = tags.get('name') or tags.get('name:vi') or (f"Tòa nhà #{w.id}" if is_bldg else f"Ranh giới #{w.id}")

            self.batch_buffer.append({
                'id': f'way/{w.id}',
                'osm_id': w.id,
                'osm_type': 'way',
                'name': name,
                'name_vi': tags.get('name:vi', name),
                'name_en': tags.get('name:en', ''),
                'admin_level': admin_lvl,
                'admin_level_label': admin_lbl,
                'priority_rank': 0 if is_bldg else rank,
                'place_type': 'building' if is_bldg else p_type,
                'tags': tags,
                'min_lon': min_lon,
                'max_lon': max_lon,
                'min_lat': min_lat,
                'max_lat': max_lat,
                'center_lon': center_lon,
                'center_lat': center_lat,
                'geometry_type': 'Polygon',
                'geometry': {'coordinates': [coords]},
                'area_approx_km2': area
            })

            if len(self.batch_buffer) >= self.batch_size:
                self.total_saved += flush_batch(self.cursor, self.batch_buffer, self.file_name)

def main():
    if len(sys.argv) < 2:
        print("❌ Thiếu đường dẫn file PBF.")
        print("Cách dùng:")
        print("    python3 scripts/import_large_osm_pbf.py <duong-dan-file.osm.pbf> [batch_size]")
        sys.exit(1)

    pbf_path = os.path.abspath(sys.argv[1])
    batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else 500

    if not os.path.exists(pbf_path):
        print(f"❌ Không tìm thấy file: {pbf_path}")
        sys.exit(1)

    file_size_bytes = os.path.getsize(pbf_path)
    file_size_mb = file_size_bytes / (1024 * 1024)
    file_name = os.path.basename(pbf_path)

    # Database connection
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        host = os.getenv("SQL_HOST") or os.getenv("PGHOST") or "localhost"
        user = os.getenv("SQL_USER") or os.getenv("PGUSER") or "postgres"
        password = os.getenv("SQL_PASSWORD") or os.getenv("PGPASSWORD") or ""
        dbname = os.getenv("SQL_DB_NAME") or os.getenv("PGDATABASE") or "osm_vietnam"
        port = os.getenv("SQL_PORT") or os.getenv("PGPORT") or "5432"
        db_url = f"postgresql://{user}:{password}@{host}:{port}/{dbname}"

    print("====================================================")
    print("🚀 PYTHON STREAMING OSM PBF IMPORTER (PYOSMIUM)")
    print(f"📁 File: {file_name} ({file_size_mb:.2f} MB)")
    print(f"📦 Batch Size: {batch_size}")
    print("====================================================")

    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()

    start_time = time.time()
    handler = OSMHandler(cur, file_name, batch_size)

    # Apply osmium stream (locations=True caches node coordinates in RAM or temporary file)
    handler.apply_file(pbf_path, locations=True)

    # Flush remaining
    if handler.batch_buffer:
        handler.total_saved += flush_batch(cur, handler.batch_buffer, file_name)

    # Audit log
    cur.execute(
        "INSERT INTO import_logs (filename, places_count, file_size, status) VALUES (%s, %s, %s, %s)",
        (file_name, handler.total_saved, file_size_bytes, 'success')
    )

    cur.close()
    conn.close()

    duration = time.time() - start_time
    print(f"\n====================================================")
    print(f"✅ THÀNH CÔNG: Đã lưu {handler.total_saved:,} địa điểm từ PBF vào PostgreSQL trong {duration:.1f}s!")
    print(f"====================================================")

if __name__ == '__main__':
    main()
