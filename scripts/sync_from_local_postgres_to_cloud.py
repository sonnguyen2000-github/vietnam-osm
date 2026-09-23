#!/usr/bin/env python3
"""
Script: Sync data from local PostgreSQL database to Cloud PostgreSQL via REST API.

Features:
- Reads records from local table `osm_places`
- Streams in batches (default: 300 records per batch)
- Sends HTTP POST to /api/sync-batch on Cloud Run
- Shows real-time progress bar, retry on transient network errors

Requirements:
    pip install psycopg2-binary requests tqdm

Usage:
    python3 scripts/sync_from_local_postgres_to_cloud.py \
        --local-db "postgresql://postgres:postgres@localhost:5432/osm_vietnam" \
        --cloud-url "https://ais-pre-gbpybipqmkmpp35kdjuhlg-529535158184.asia-southeast1.run.app" \
        --batch-size 300
"""

import sys
import json
import time
import argparse

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("❌ Thiếu psycopg2. Vui lòng cài đặt: pip install psycopg2-binary requests tqdm")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("❌ Thiếu requests. Vui lòng cài đặt: pip install requests tqdm")
    sys.exit(1)

try:
    from tqdm import tqdm
except ImportError:
    # Fallback if tqdm not installed
    def tqdm(iterable, total=None, desc=""):
        count = 0
        for item in iterable:
            yield item
            count += 1
            if count % 10 == 0 or count == total:
                print(f"[{desc}] Tiến độ: {count}/{total or '?'}")


def main():
    parser = argparse.ArgumentParser(description="Đồng bộ dữ liệu từ PostgreSQL Local lên Cloud Applet")
    parser.add_argument(
        "--local-db",
        default="postgresql://postgres:postgres@localhost:5432/osm_vietnam",
        help="Chuỗi kết nối PostgreSQL local (ví dụ: postgresql://user:pass@localhost:5432/osm_vietnam)",
    )
    parser.add_argument(
        "--cloud-url",
        default="https://ais-pre-gbpybipqmkmpp35kdjuhlg-529535158184.asia-southeast1.run.app",
        help="Địa chỉ ứng dụng Cloud Applet",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=300,
        help="Số lượng bản ghi mỗi đợt đồng bộ (mặc định: 300)",
    )
    parser.add_argument(
        "--table",
        default="osm_places",
        help="Tên bảng dữ liệu local (mặc định: osm_places)",
    )
    parser.add_argument(
        "--where",
        default="",
        help="Điều kiện lọc bổ sung (ví dụ: admin_level IN ('2','4','6'))",
    )

    args = parser.parse_args()
    cloud_api = args.cloud_url.rstrip("/") + "/api/sync-batch"

    print("=" * 70)
    print("🚀 ĐỒNG BỘ DỮ LIỆU POSTGRESQL LOCAL ➔ CLOUD")
    print(f"  • Nguồn Local: {args.local_db}")
    print(f"  • Đích Cloud: {cloud_api}")
    print(f"  • Kích thước lô: {args.batch_size} bản ghi/lần")
    print("=" * 70)

    # 1. Test Cloud connection
    try:
        health_res = requests.get(args.cloud_url.rstrip("/") + "/api/health", timeout=10)
        if health_res.status_code == 200:
            print("✅ Đã kết nối thành công tới máy chủ Cloud!")
        else:
            print(f"⚠️ Máy chủ Cloud phản hồi mã {health_res.status_code}, đang tiếp tục...")
    except Exception as e:
        print(f"❌ Không thể kết nối tới Cloud URL: {e}")
        sys.exit(1)

    # 2. Connect to local PostgreSQL
    try:
        conn = psycopg2.connect(args.local_db)
        cur = conn.cursor(cursor_factory=RealDictCursor)
        print("✅ Đã kết nối thành công tới PostgreSQL Local!")
    except Exception as e:
        print(f"❌ Không thể kết nối tới PostgreSQL local: {e}")
        sys.exit(1)

    # 3. Count total records
    count_query = f"SELECT COUNT(*) AS total FROM {args.table}"
    if args.where:
        count_query += f" WHERE {args.where}"
    cur.execute(count_query)
    total_records = cur.fetchone()["total"]
    print(f"📊 Tìm thấy tổng cộng {total_records:,} bản ghi cần đồng bộ.")

    if total_records == 0:
        print("Không có bản ghi nào để đồng bộ.")
        cur.close()
        conn.close()
        return

    # 4. Fetch and push in batches
    select_query = f"""
        SELECT 
            id, osm_id, osm_type, name, name_vi, name_en,
            admin_level, admin_level_label, priority_rank, place_type,
            tags, min_lon, min_lat, max_lon, max_lat, center_lon, center_lat,
            geometry_type, geometry, area_approx_km2
        FROM {args.table}
    """
    if args.where:
        select_query += f" WHERE {args.where}"
    select_query += " ORDER BY id"

    cur.execute(select_query)

    synced_count = 0
    batch_num = 0
    pbar = tqdm(total=total_records, desc="Đang đồng bộ")

    while True:
        rows = cur.fetchmany(args.batch_size)
        if not rows:
            break

        batch_num += 1
        places = []
        for r in rows:
            # Map DB row to API JSON format expected by savePlacesToDb
            places.append({
                "id": str(r["id"]),
                "osmId": int(r["osm_id"]),
                "osmType": str(r["osm_type"]),
                "name": str(r["name"]),
                "nameVi": r["name_vi"],
                "nameEn": r["name_en"],
                "adminLevel": str(r["admin_level"]),
                "adminLevelLabel": str(r["admin_level_label"]),
                "priorityRank": int(r["priority_rank"] or 0),
                "placeType": str(r["place_type"]),
                "tags": r["tags"] if isinstance(r["tags"], dict) else (json.loads(r["tags"]) if r["tags"] else {}),
                "bbox": {
                    "minLon": float(r["min_lon"]),
                    "minLat": float(r["min_lat"]),
                    "maxLon": float(r["max_lon"]),
                    "maxLat": float(r["max_lat"]),
                },
                "center": [float(r["center_lon"]), float(r["center_lat"])],
                "geometryType": str(r["geometry_type"]),
                "geometry": r["geometry"] if isinstance(r["geometry"], dict) else json.loads(r["geometry"]),
                "areaApproxKm2": float(r["area_approx_km2"]) if r["area_approx_km2"] is not None else None,
            })

        # Post batch with retry
        max_retries = 3
        success = False
        for attempt in range(max_retries):
            try:
                res = requests.post(
                    cloud_api,
                    json={
                        "places": places,
                        "source": f"local_pg_sync_{int(time.time())}",
                        "filename": f"batch_{batch_num}",
                    },
                    timeout=60,
                )
                if res.status_code == 200 and res.json().get("success"):
                    success = True
                    synced_count += len(places)
                    pbar.update(len(places))
                    break
                else:
                    print(f"\n⚠️ Lỗi lô #{batch_num} (mã {res.status_code}): {res.text}. Thử lại lần {attempt+1}...")
                    time.sleep(2)
            except Exception as e:
                print(f"\n⚠️ Kết nối mạng thất bại lô #{batch_num}: {e}. Thử lại lần {attempt+1}...")
                time.sleep(2)

        if not success:
            print(f"\n❌ Thất bại khi gửi lô #{batch_num}. Quá trình đồng bộ tạm dừng.")
            break

    pbar.close()
    cur.close()
    conn.close()

    print("=" * 70)
    print(f"🎉 Hoàn tất! Đã đồng bộ thành công {synced_count:,}/{total_records:,} bản ghi lên Cloud PostgreSQL.")
    print("=" * 70)


if __name__ == "__main__":
    main()
