-- ==============================================================================
-- POSTGRESQL INITIALIZATION SCRIPT FOR LOCAL DATABASE (OSM VIETNAM HIERARCHY)
-- ==============================================================================

-- 1. TẠO DATABASE (Chạy lệnh này nếu bạn đang kết nối vào database mặc định 'postgres')
-- CREATE DATABASE osm_vietnam WITH OWNER postgres ENCODING 'UTF8';
-- \c osm_vietnam;

-- Tùy chọn: Kích hoạt extension hỗ trợ tìm kiếm không dấu (unaccent) và UUID (nếu cần)
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ==============================================================================
-- 2. TẠO BẢNG 'users' (Quản lý tài khoản đăng nhập)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    uid TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_uid ON users (uid);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ==============================================================================
-- 3. TẠO BẢNG 'osm_places' (Bảng cốt lõi lưu ranh giới hành chính, tòa nhà & POI)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS osm_places (
    id TEXT PRIMARY KEY,                            -- Định danh dạng: 'rel/123', 'way/456', 'node/789'
    osm_id BIGINT NOT NULL,                         -- ID gốc từ OpenStreetMap
    osm_type TEXT NOT NULL,                         -- 'relation' | 'way' | 'node'
    name TEXT NOT NULL,                             -- Tên địa danh / Tên tòa nhà
    name_vi TEXT,                                   -- Tên tiếng Việt
    name_en TEXT,                                   -- Tên tiếng Anh (nếu có)
    admin_level TEXT NOT NULL,                      -- Cấp hành chính: '2', '4', '6', '8', 'building', 'poi'
    admin_level_label TEXT NOT NULL,                -- Nhãn hiển thị tiếng Việt (vd: Tỉnh / Thành phố)
    priority_rank INTEGER NOT NULL,                 -- Mức ưu tiên phân cấp (càng nhỏ càng chi tiết)
    place_type TEXT NOT NULL,                       -- 'country' | 'province' | 'district' | 'ward' | 'building' | 'poi'
    tags JSONB NOT NULL DEFAULT '{}'::jsonb,        -- Toàn bộ thẻ OSM gốc dạng JSON key-value
    min_lon DOUBLE PRECISION NOT NULL,              -- Bounding Box: Kinh độ nhỏ nhất
    min_lat DOUBLE PRECISION NOT NULL,              -- Bounding Box: Vĩ độ nhỏ nhất
    max_lon DOUBLE PRECISION NOT NULL,              -- Bounding Box: Kinh độ lớn nhất
    max_lat DOUBLE PRECISION NOT NULL,              -- Bounding Box: Vĩ độ lớn nhất
    center_lon DOUBLE PRECISION NOT NULL,           -- Kinh độ tâm
    center_lat DOUBLE PRECISION NOT NULL,           -- Vĩ độ tâm
    geometry_type TEXT NOT NULL,                    -- 'Polygon' | 'MultiPolygon' | 'Point'
    geometry JSONB NOT NULL,                        -- Tọa độ ranh giới GeoJSON { coordinates: [...] }
    area_approx_km2 DOUBLE PRECISION,               -- Diện tích xấp xỉ (km2)
    source TEXT DEFAULT 'import',                   -- Nguồn dữ liệu (tên file nạp vào)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Các chỉ mục (Indexes) tối ưu hóa tốc độ truy vấn không gian & lọc phân cấp
CREATE INDEX IF NOT EXISTS idx_osm_places_bbox 
    ON osm_places (min_lon, max_lon, min_lat, max_lat);

CREATE INDEX IF NOT EXISTS idx_osm_places_center 
    ON osm_places (center_lat, center_lon);

CREATE INDEX IF NOT EXISTS idx_osm_places_admin_level 
    ON osm_places (admin_level);

CREATE INDEX IF NOT EXISTS idx_osm_places_place_type 
    ON osm_places (place_type);

CREATE INDEX IF NOT EXISTS idx_osm_places_osm_type_id 
    ON osm_places (osm_type, osm_id);

CREATE INDEX IF NOT EXISTS idx_osm_places_name_trgm 
    ON osm_places USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_osm_places_tags 
    ON osm_places USING gin (tags);

-- ==============================================================================
-- 4. TẠO BẢNG 'import_logs' (Nhật ký lịch sử các lần nạp file OSM)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS import_logs (
    id SERIAL PRIMARY KEY,
    filename TEXT NOT NULL,                         -- Tên file đã tải lên
    places_count INTEGER NOT NULL,                  -- Số lượng địa điểm đã import thành công
    file_size BIGINT,                               -- Dung lượng file (bytes)
    status TEXT DEFAULT 'success',                  -- 'success' | 'failed' | 'processing'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_import_logs_created_at 
    ON import_logs (created_at DESC);
