#!/usr/bin/env python3
"""
Python Script: Import large OSM XML (.osm) directly into PostgreSQL database.
Uses streaming iterparse (O(1) memory per tag) and psycopg2 execute_values for high throughput.

Requirements:
    pip install psycopg2-binary

Usage:
    export DATABASE_URL="postgresql://user:password@host:port/dbname"
    python3 scripts/import_large_osm_xml.py /path/to/vietnam.osm [batch_size]

Example:
    python3 scripts/import_large_osm_xml.py ./vietnam-latest.osm 500
"""

import sys
import os
import json
import time
import math
import xml.etree.cElementTree as ET
import psycopg2
from psycopg2.extras import execute_values

# Vietnam approximate Bounding Box filter
VN_BBOX = {
    'min_lon': 102.0,
    'max_lon': 110.5,
    'min_lat': 8.0,
    'max_lat': 24.0,
}

def get_admin_meta(tags):
    admin_level_raw = tags.get('admin_level')
    boundary = tags.get('boundary')
    place = tags.get('place')
    building = tags.get('building')

    if admin_level_raw:
        try:
            lvl = int(admin_level_raw)
            if lvl == 2:
                return 2, 'Quốc gia', 7, 'country'
            elif lvl == 3:
                return 3, 'Vùng địa lý', 6, 'region'
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
        return 'building', 'Tòa nhà / Công trình', 0, 'building'

    if place == 'country':
        return 2, 'Quốc gia', 7, 'country'
    elif place in ('state', 'province'):
        return 4, 'Tỉnh / Thành phố', 5, 'province'
    elif place in ('city', 'county', 'district'):
        return 6, 'Quận / Huyện / Thành phố', 4, 'district'
    elif place in ('town', 'village', 'suburb', 'quarter'):
        return 8, 'Phường / Xã / Thị trấn', 3, 'ward'

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

def main():
    if len(sys.argv) < 2:
        print("❌ Thiếu đường dẫn file XML.")
        print("Cách dùng:")
        print("    python3 scripts/import_large_osm_xml.py <duong-dan-file.osm> [batch_size]")
        sys.exit(1)

    xml_path = os.path.abspath(sys.argv[1])
    batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else 500

    if not os.path.exists(xml_path):
        print(f"❌ Không tìm thấy file: {xml_path}")
        sys.exit(1)

    file_size_bytes = os.path.getsize(xml_path)
    file_size_mb = file_size_bytes / (1024 * 1024)
    file_name = os.path.basename(xml_path)

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
    print("🚀 PYTHON STREAMING OSM XML IMPORTER")
    print(f"📁 File: {file_name} ({file_size_mb:.2f} MB)")
    print(f"📦 Batch Size: {batch_size}")
    print("====================================================")

    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()

    start_time = time.time()
    total_saved = 0
    batch_buffer = []

    # Map of nodeId -> (lon, lat)
    node_coords = {}
    pending_ways = {} # wayId -> {'refs': [...], 'tags': {...}}
    pending_relations = []

    node_count = 0
    way_count = 0
    rel_count = 0
    last_print = time.time()

    # Pass 1: Streaming iterparse
    context = ET.iterparse(xml_path, events=('end',))

    for event, elem in context:
        tag = elem.tag

        if tag == 'node':
            node_count += 1
            node_id = int(elem.attrib['id'])
            lat = float(elem.attrib['lat'])
            lon = float(elem.attrib['lon'])

            tags = {}
            for child in elem:
                if child.tag == 'tag':
                    tags[child.attrib['k']] = child.attrib['v']

            if (VN_BBOX['min_lat'] <= lat <= VN_BBOX['max_lat'] and
                VN_BBOX['min_lon'] <= lon <= VN_BBOX['max_lon']):
                node_coords[node_id] = (lon, lat)

                name = tags.get('name') or tags.get('name:vi') or tags.get('name:en')
                if name and (tags.get('place') or tags.get('amenity') or tags.get('tourism') or
                             tags.get('historic') or tags.get('leisure') or tags.get('shop')):
                    admin_lvl, admin_lbl, rank, p_type = get_admin_meta(tags)
                    batch_buffer.append({
                        'id': f'node/{node_id}',
                        'osm_id': node_id,
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

                    if len(batch_buffer) >= batch_size:
                        total_saved += flush_batch(cur, batch_buffer, file_name)

            elem.clear()

        elif tag == 'way':
            way_count += 1
            way_id = int(elem.attrib['id'])
            refs = []
            tags = {}
            for child in elem:
                if child.tag == 'nd':
                    refs.append(int(child.attrib['ref']))
                elif child.tag == 'tag':
                    tags[child.attrib['k']] = child.attrib['v']

            is_bldg = bool(tags.get('building') and tags.get('building') != 'no')
            is_bndry = bool(tags.get('boundary') == 'administrative' or tags.get('admin_level'))

            if (is_bldg or is_bndry) and len(refs) >= 3:
                pending_ways[way_id] = {'refs': refs, 'tags': tags}

            elem.clear()

        elif tag == 'relation':
            rel_count += 1
            rel_id = int(elem.attrib['id'])
            members = []
            tags = {}
            for child in elem:
                if child.tag == 'member':
                    members.append({
                        'type': child.attrib.get('type', 'way'),
                        'id': int(child.attrib['ref']),
                        'role': child.attrib.get('role', '')
                    })
                elif child.tag == 'tag':
                    tags[child.attrib['k']] = child.attrib['v']

            if tags.get('boundary') == 'administrative' or tags.get('type') in ('boundary', 'multipolygon'):
                pending_relations.append({'id': rel_id, 'members': members, 'tags': tags})

            elem.clear()

        # Periodic status
        now = time.time()
        if now - last_print > 3:
            last_print = now
            print(f"\r⏳ Tiến trình: {node_count:,} nodes | {way_count:,} ways | {rel_count:,} relations | Đã lưu: {total_saved:,}", end='', flush=True)

    print(f"\n🔄 Đang xử lý {len(pending_ways):,} ways...")

    # Process Ways
    for way_id, way in pending_ways.items():
        refs = way['refs']
        tags = way['tags']
        is_bldg = bool(tags.get('building') and tags.get('building') != 'no')
        is_bndry = bool(tags.get('boundary') == 'administrative')

        coords = [node_coords[ref] for ref in refs if ref in node_coords]
        if len(coords) < 3:
            continue

        if coords[0] != coords[-1]:
            coords.append(coords[0])

        min_lon, min_lat, max_lon, max_lat = compute_bounding_box(coords)
        center_lon = (min_lon + max_lon) / 2.0
        center_lat = (min_lat + max_lat) / 2.0
        area = calculate_approx_area_km2(coords)

        admin_lvl, admin_lbl, rank, p_type = get_admin_meta(tags)
        name = tags.get('name') or tags.get('name:vi') or (f"Công trình #{way_id}" if is_bldg else f"Ranh giới #{way_id}")

        batch_buffer.append({
            'id': f'way/{way_id}',
            'osm_id': way_id,
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

        if len(batch_buffer) >= batch_size:
            total_saved += flush_batch(cur, batch_buffer, file_name)

    print(f"\n🔄 Đang xử lý {len(pending_relations):,} relations...")

    # Process Relations
    for rel in pending_relations:
        rel_id = rel['id']
        tags = rel['tags']
        name = tags.get('name') or tags.get('name:vi') or tags.get('name:en')
        if not name:
            continue

        outer_coords = []
        for m in rel['members']:
            if m['type'] == 'way' and m['id'] in pending_ways:
                w_refs = pending_ways[m['id']]['refs']
                w_pts = [node_coords[r] for r in w_refs if r in node_coords]
                if len(w_pts) >= 2:
                    outer_coords.extend(w_pts)

        if len(outer_coords) < 3:
            continue

        if outer_coords[0] != outer_coords[-1]:
            outer_coords.append(outer_coords[0])

        min_lon, min_lat, max_lon, max_lat = compute_bounding_box(outer_coords)
        center_lon = (min_lon + max_lon) / 2.0
        center_lat = (min_lat + max_lat) / 2.0
        area = calculate_approx_area_km2(outer_coords)

        admin_lvl, admin_lbl, rank, p_type = get_admin_meta(tags)

        batch_buffer.append({
            'id': f'rel/{rel_id}',
            'osm_id': rel_id,
            'osm_type': 'relation',
            'name': name,
            'name_vi': tags.get('name:vi', name),
            'name_en': tags.get('name:en', ''),
            'admin_level': admin_lvl,
            'admin_level_label': admin_lbl,
            'priority_rank': rank,
            'place_type': p_type,
            'tags': tags,
            'min_lon': min_lon,
            'max_lon': max_lon,
            'min_lat': min_lat,
            'max_lat': max_lat,
            'center_lon': center_lon,
            'center_lat': center_lat,
            'geometry_type': 'Polygon',
            'geometry': {'coordinates': [outer_coords]},
            'area_approx_km2': area
        })

        if len(batch_buffer) >= batch_size:
            total_saved += flush_batch(cur, batch_buffer, file_name)

    # Flush final
    if batch_buffer:
        total_saved += flush_batch(cur, batch_buffer, file_name)

    # Audit log
    cur.execute(
        "INSERT INTO import_logs (filename, places_count, file_size, status) VALUES (%s, %s, %s, %s)",
        (file_name, total_saved, file_size_bytes, 'success')
    )

    cur.close()
    conn.close()

    duration = time.time() - start_time
    print(f"\n====================================================")
    print(f"✅ THÀNH CÔNG: Đã lưu {total_saved:,} địa điểm vào PostgreSQL trong {duration:.1f}s!")
    print(f"====================================================")

if __name__ == '__main__':
    main()
