import { OSMPlace } from './types';
import { computeBoundingBox } from './spatialIndex';

function makePolygon(
  id: string,
  osmId: number,
  osmType: 'relation' | 'way' | 'node',
  name: string,
  nameVi: string,
  nameEn: string,
  adminLevel: number | string,
  adminLevelLabel: string,
  priorityRank: number,
  placeType: OSMPlace['placeType'],
  tags: Record<string, string>,
  ring: number[][],
  areaApproxKm2: number
): OSMPlace {
  const coordinates = [ring];
  const bbox = computeBoundingBox(coordinates);
  const center: [number, number] = [
    (bbox.minLon + bbox.maxLon) / 2,
    (bbox.minLat + bbox.maxLat) / 2,
  ];

  return {
    id,
    osmId,
    osmType,
    name,
    nameVi,
    nameEn,
    adminLevel,
    adminLevelLabel,
    priorityRank,
    placeType,
    tags: {
      ...tags,
      name,
      'name:vi': nameVi,
      'name:en': nameEn,
      admin_level: String(adminLevel),
    },
    bbox,
    center,
    geometryType: 'Polygon',
    geometry: {
      coordinates,
    },
    areaApproxKm2,
  };
}

function makePoint(
  id: string,
  osmId: number,
  name: string,
  nameVi: string,
  nameEn: string,
  tags: Record<string, string>,
  lon: number,
  lat: number
): OSMPlace {
  return {
    id,
    osmId,
    osmType: 'node',
    name,
    nameVi,
    nameEn,
    adminLevel: 'poi',
    adminLevelLabel: 'Địa điểm / Điểm quan tâm',
    priorityRank: 1,
    placeType: 'poi',
    tags: {
      ...tags,
      name,
      'name:vi': nameVi,
      'name:en': nameEn,
    },
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
    areaApproxKm2: 0.05,
  };
}

function makeBuildingPolygon(
  id: string,
  osmId: number,
  name: string,
  nameVi: string,
  nameEn: string,
  buildingTypeLabel: string,
  tags: Record<string, string>,
  ring: number[][],
  areaApproxKm2 = 0.00005
): OSMPlace {
  const coordinates = [ring];
  const bbox = computeBoundingBox(coordinates);
  const center: [number, number] = [
    (bbox.minLon + bbox.maxLon) / 2,
    (bbox.minLat + bbox.maxLat) / 2,
  ];

  return {
    id,
    osmId,
    osmType: 'way',
    name,
    nameVi,
    nameEn,
    adminLevel: 'building',
    adminLevelLabel: buildingTypeLabel,
    priorityRank: 0.5,
    placeType: 'building',
    tags: {
      ...tags,
      name,
      'name:vi': nameVi,
      'name:en': nameEn,
      admin_level: 'building',
    },
    bbox,
    center,
    geometryType: 'Polygon',
    geometry: {
      coordinates,
    },
    areaApproxKm2,
  };
}

/**
 * Rich out-of-the-box dataset for Vietnam administrative hierarchy and major points
 */
export function getDefaultVietnamPlaces(): OSMPlace[] {
  const places: OSMPlace[] = [];

  // ==========================================
  // LEVEL 2: QUỐC GIA (VIỆT NAM)
  // ==========================================
  // Simplified realistic boundary covering mainland Vietnam
  const vietnamMainlandRing: number[][] = [
    [102.14, 22.40],
    [104.00, 22.75],
    [105.30, 23.39], // Lung Cu - Ha Giang
    [106.70, 23.10],
    [107.95, 21.55], // Mong Cai
    [107.00, 20.85], // Ha Long Bay
    [106.30, 20.25], // Thai Binh / Nam Dinh
    [105.90, 19.80], // Thanh Hoa
    [105.70, 18.70], // Nghe An
    [106.30, 17.50], // Quang Binh
    [107.20, 16.80], // Quang Tri
    [107.60, 16.50], // Hue
    [108.25, 16.10], // Da Nang
    [108.90, 15.60], // Quang Nam
    [109.15, 15.15], // Quang Ngai
    [109.30, 13.75], // Quy Nhon
    [109.40, 12.30], // Nha Trang
    [109.00, 11.55], // Phan Rang
    [108.10, 10.95], // Phan Thiet
    [107.20, 10.35], // Vung Tau
    [106.80, 10.25], // Can Gio
    [106.50, 9.50],  // Ben Tre / Soc Trang
    [105.80, 8.60],  // Bac Lieu / Ca Mau
    [104.75, 8.56],  // Mui Ca Mau
    [104.90, 9.80],  // Kien Giang
    [104.45, 10.40], // Ha Tien
    [105.10, 10.70], // An Giang
    [105.80, 11.00], // Dong Thap
    [106.00, 11.40], // Tay Ninh border
    [106.80, 11.80], // Binh Phuoc
    [107.50, 12.20], // Dak Nong
    [107.50, 13.50], // Gia Lai
    [107.70, 14.70], // Kon Tum
    [107.30, 15.50], // Quang Nam border
    [106.50, 16.50], // Quang Tri border
    [105.80, 17.80], // Ha Tinh border
    [105.20, 18.60], // Nghe An border
    [104.50, 19.80], // Thanh Hoa border
    [103.50, 21.00], // Son La
    [102.50, 21.80], // Dien Bien
    [102.14, 22.40], // back to start
  ];

  places.push(
    makePolygon(
      'rel/49915',
      49915,
      'relation',
      'Việt Nam',
      'Việt Nam',
      'Vietnam',
      2,
      'Quốc gia',
      7,
      'country',
      {
        boundary: 'administrative',
        'ISO3166-1': 'VN',
        'ISO3166-1:alpha2': 'VN',
        'ISO3166-1:alpha3': 'VNM',
        'ISO3166-1:numeric': '704',
        type: 'boundary',
        wikidata: 'Q881',
      },
      vietnamMainlandRing,
      331690
    )
  );

  // ==========================================
  // LEVEL 3: CÁC VÙNG KINH TẾ / ĐỊA LÝ
  // ==========================================
  // Đồng bằng sông Hồng (Red River Delta)
  places.push(
    makePolygon(
      'rel/301',
      301,
      'relation',
      'Đồng bằng sông Hồng',
      'Đồng bằng sông Hồng',
      'Red River Delta',
      3,
      'Vùng địa lý',
      6,
      'region',
      { boundary: 'administrative', region_type: 'delta' },
      [
        [105.20, 21.50],
        [106.80, 21.50],
        [107.20, 20.80],
        [106.60, 20.10],
        [105.70, 20.10],
        [105.20, 20.80],
        [105.20, 21.50],
      ],
      14965
    )
  );

  // Đông Nam Bộ (Southeast Vietnam)
  places.push(
    makePolygon(
      'rel/302',
      302,
      'relation',
      'Đông Nam Bộ',
      'Đông Nam Bộ',
      'Southeast',
      3,
      'Vùng địa lý',
      6,
      'region',
      { boundary: 'administrative', region_type: 'southeast' },
      [
        [105.80, 11.80],
        [107.60, 11.90],
        [107.60, 10.40],
        [106.50, 10.20],
        [106.10, 10.90],
        [105.80, 11.80],
      ],
      23560
    )
  );

  // Duyên hải Nam Trung Bộ
  places.push(
    makePolygon(
      'rel/303',
      303,
      'relation',
      'Duyên hải Nam Trung Bộ',
      'Duyên hải Nam Trung Bộ',
      'South Central Coast',
      3,
      'Vùng địa lý',
      6,
      'region',
      { boundary: 'administrative' },
      [
        [108.00, 16.20],
        [109.30, 16.10],
        [109.50, 12.00],
        [108.50, 11.00],
        [108.00, 14.00],
        [108.00, 16.20],
      ],
      44372
    )
  );

  // Đồng bằng sông Cửu Long (Mekong Delta)
  places.push(
    makePolygon(
      'rel/304',
      304,
      'relation',
      'Đồng bằng sông Cửu Long',
      'Đồng bằng sông Cửu Long',
      'Mekong Delta',
      3,
      'Vùng địa lý',
      6,
      'region',
      { boundary: 'administrative' },
      [
        [104.50, 10.50],
        [106.50, 10.50],
        [106.70, 9.50],
        [105.00, 8.50],
        [104.50, 9.50],
        [104.50, 10.50],
      ],
      40577
    )
  );

  // ==========================================
  // LEVEL 4: TỈNH / THÀNH PHỐ TRỰC THUỘC TW
  // ==========================================

  // 1. Hà Nội
  places.push(
    makePolygon(
      'rel/1971714',
      1971714,
      'relation',
      'Thành phố Hà Nội',
      'Thành phố Hà Nội',
      'Hanoi',
      4,
      'Thành phố trực thuộc Trung ương',
      5,
      'province',
      {
        boundary: 'administrative',
        capital: 'yes',
        place: 'city',
        'ISO3166-2': 'VN-HN',
        wikidata: 'Q1858',
      },
      [
        [105.35, 21.38],
        [105.80, 21.42],
        [106.02, 21.18],
        [106.01, 20.85],
        [105.85, 20.60],
        [105.45, 20.55],
        [105.30, 20.85],
        [105.28, 21.15],
        [105.35, 21.38],
      ],
      3358
    )
  );

  // 2. TP. Hồ Chí Minh
  places.push(
    makePolygon(
      'rel/1971717',
      1971717,
      'relation',
      'Thành phố Hồ Chí Minh',
      'Thành phố Hồ Chí Minh',
      'Ho Chi Minh City',
      4,
      'Thành phố trực thuộc Trung ương',
      5,
      'province',
      {
        boundary: 'administrative',
        place: 'city',
        'ISO3166-2': 'VN-SG',
        wikidata: 'Q1803',
      },
      [
        [106.35, 11.16],
        [106.65, 11.15],
        [106.90, 10.85],
        [107.03, 10.45],
        [106.85, 10.35],
        [106.65, 10.55],
        [106.40, 10.65],
        [106.35, 11.16],
      ],
      2095
    )
  );

  // 3. Đà Nẵng
  places.push(
    makePolygon(
      'rel/1971715',
      1971715,
      'relation',
      'Thành phố Đà Nẵng',
      'Thành phố Đà Nẵng',
      'Da Nang',
      4,
      'Thành phố trực thuộc Trung ương',
      5,
      'province',
      {
        boundary: 'administrative',
        place: 'city',
        'ISO3166-2': 'VN-DN',
        wikidata: 'Q25282',
      },
      [
        [107.82, 16.20],
        [108.35, 16.15],
        [108.30, 15.90],
        [108.05, 15.90],
        [107.80, 16.05],
        [107.82, 16.20],
      ],
      1285
    )
  );

  // 4. Hải Phòng
  places.push(
    makePolygon(
      'rel/1971716',
      1971716,
      'relation',
      'Thành phố Hải Phòng',
      'Thành phố Hải Phòng',
      'Hai Phong',
      4,
      'Thành phố trực thuộc Trung ương',
      5,
      'province',
      {
        boundary: 'administrative',
        place: 'city',
        'ISO3166-2': 'VN-HP',
        wikidata: 'Q36167',
      },
      [
        [106.50, 20.95],
        [107.10, 20.85],
        [106.95, 20.55],
        [106.45, 20.60],
        [106.50, 20.95],
      ],
      1527
    )
  );

  // 5. Cần Thơ
  places.push(
    makePolygon(
      'rel/1971718',
      1971718,
      'relation',
      'Thành phố Cần Thơ',
      'Thành phố Cần Thơ',
      'Can Tho',
      4,
      'Thành phố trực thuộc Trung ương',
      5,
      'province',
      {
        boundary: 'administrative',
        place: 'city',
        'ISO3166-2': 'VN-CT',
        wikidata: 'Q216075',
      },
      [
        [105.45, 10.32],
        [105.85, 10.15],
        [105.85, 9.90],
        [105.50, 9.85],
        [105.45, 10.32],
      ],
      1439
    )
  );

  // 6. Thừa Thiên Huế
  places.push(
    makePolygon(
      'rel/1971720',
      1971720,
      'relation',
      'Tỉnh Thừa Thiên Huế',
      'Tỉnh Thừa Thiên Huế',
      'Thua Thien Hue',
      4,
      'Tỉnh',
      5,
      'province',
      { boundary: 'administrative', 'ISO3166-2': 'VN-26', wikidata: 'Q36587' },
      [
        [107.10, 16.70],
        [108.05, 16.35],
        [107.80, 15.95],
        [107.20, 16.15],
        [107.10, 16.70],
      ],
      5033
    )
  );

  // 7. Quảng Ninh (Hạ Long)
  places.push(
    makePolygon(
      'rel/1971721',
      1971721,
      'relation',
      'Tỉnh Quảng Ninh',
      'Tỉnh Quảng Ninh',
      'Quang Ninh',
      4,
      'Tỉnh',
      5,
      'province',
      { boundary: 'administrative', 'ISO3166-2': 'VN-14', wikidata: 'Q36873' },
      [
        [106.60, 21.60],
        [108.00, 21.50],
        [107.50, 20.70],
        [106.70, 20.85],
        [106.60, 21.60],
      ],
      6178
    )
  );

  // 8. Khánh Hòa (Nha Trang)
  places.push(
    makePolygon(
      'rel/1971722',
      1971722,
      'relation',
      'Tỉnh Khánh Hòa',
      'Tỉnh Khánh Hòa',
      'Khanh Hoa',
      4,
      'Tỉnh',
      5,
      'province',
      { boundary: 'administrative', 'ISO3166-2': 'VN-34', wikidata: 'Q36399' },
      [
        [108.70, 12.80],
        [109.35, 12.80],
        [109.30, 11.85],
        [108.85, 11.90],
        [108.70, 12.80],
      ],
      5217
    )
  );

  // 9. Lâm Đồng (Đà Lạt)
  places.push(
    makePolygon(
      'rel/1971723',
      1971723,
      'relation',
      'Tỉnh Lâm Đồng',
      'Tỉnh Lâm Đồng',
      'Lam Dong',
      4,
      'Tỉnh',
      5,
      'province',
      { boundary: 'administrative', 'ISO3166-2': 'VN-35', wikidata: 'Q36869' },
      [
        [107.30, 12.20],
        [108.70, 12.10],
        [108.40, 11.30],
        [107.40, 11.40],
        [107.30, 12.20],
      ],
      9783
    )
  );

  // ==========================================
  // LEVEL 6: QUẬN / HUYỆN / THỊ XÃ
  // ==========================================

  // --- HÀ NỘI DISTRICTS ---
  // Quận Hoàn Kiếm
  places.push(
    makePolygon(
      'rel/2501',
      2501,
      'relation',
      'Quận Hoàn Kiếm',
      'Quận Hoàn Kiếm',
      'Hoan Kiem District',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative', district_type: 'urban' },
      [
        [105.838, 21.042],
        [105.865, 21.041],
        [105.870, 21.018],
        [105.845, 21.017],
        [105.838, 21.042],
      ],
      5.29
    )
  );

  // Quận Ba Đình
  places.push(
    makePolygon(
      'rel/2502',
      2502,
      'relation',
      'Quận Ba Đình',
      'Quận Ba Đình',
      'Ba Dinh District',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative' },
      [
        [105.805, 21.050],
        [105.840, 21.048],
        [105.838, 21.025],
        [105.805, 21.026],
        [105.805, 21.050],
      ],
      9.21
    )
  );

  // Quận Tây Hồ
  places.push(
    makePolygon(
      'rel/2503',
      2503,
      'relation',
      'Quận Tây Hồ',
      'Quận Tây Hồ',
      'Tay Ho District',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative' },
      [
        [105.800, 21.090],
        [105.850, 21.085],
        [105.845, 21.045],
        [105.800, 21.048],
        [105.800, 21.090],
      ],
      24.0
    )
  );

  // Quận Đống Đa
  places.push(
    makePolygon(
      'rel/2504',
      2504,
      'relation',
      'Quận Đống Đa',
      'Quận Đống Đa',
      'Dong Da District',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative' },
      [
        [105.808, 21.028],
        [105.842, 21.026],
        [105.838, 20.998],
        [105.805, 21.002],
        [105.808, 21.028],
      ],
      9.96
    )
  );

  // Quận Cầu Giấy
  places.push(
    makePolygon(
      'rel/2505',
      2505,
      'relation',
      'Quận Cầu Giấy',
      'Quận Cầu Giấy',
      'Cau Giay District',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative' },
      [
        [105.775, 21.045],
        [105.808, 21.042],
        [105.805, 21.015],
        [105.775, 21.015],
        [105.775, 21.045],
      ],
      12.04
    )
  );

  // --- TP. HỒ CHÍ MINH DISTRICTS ---
  // Quận 1
  places.push(
    makePolygon(
      'rel/2601',
      2601,
      'relation',
      'Quận 1',
      'Quận 1',
      'District 1',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative', district_type: 'urban' },
      [
        [106.685, 10.790],
        [106.710, 10.785],
        [106.715, 10.760],
        [106.688, 10.755],
        [106.685, 10.790],
      ],
      7.72
    )
  );

  // Quận 3
  places.push(
    makePolygon(
      'rel/2602',
      2602,
      'relation',
      'Quận 3',
      'Quận 3',
      'District 3',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative' },
      [
        [106.670, 10.792],
        [106.690, 10.790],
        [106.692, 10.770],
        [106.672, 10.772],
        [106.670, 10.792],
      ],
      4.92
    )
  );

  // Thành phố Thủ Đức
  places.push(
    makePolygon(
      'rel/2603',
      2603,
      'relation',
      'Thành phố Thủ Đức',
      'Thành phố Thủ Đức',
      'Thu Duc City',
      6,
      'Thành phố thuộc tỉnh / TW',
      4,
      'district',
      { boundary: 'administrative', place: 'city' },
      [
        [106.732, 10.880],
        [106.850, 10.870],
        [106.840, 10.740],
        [106.735, 10.765],
        [106.732, 10.880],
      ],
      211.56
    )
  );

  // Quận Bình Thạnh
  places.push(
    makePolygon(
      'rel/2604',
      2604,
      'relation',
      'Quận Bình Thạnh',
      'Quận Bình Thạnh',
      'Binh Thanh District',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative' },
      [
        [106.685, 10.825],
        [106.730, 10.815],
        [106.720, 10.785],
        [106.690, 10.790],
        [106.685, 10.825],
      ],
      20.78
    )
  );

  // --- ĐÀ NẴNG DISTRICTS ---
  // Quận Hải Châu
  places.push(
    makePolygon(
      'rel/2701',
      2701,
      'relation',
      'Quận Hải Châu',
      'Quận Hải Châu',
      'Hai Chau District',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative' },
      [
        [108.200, 16.085],
        [108.235, 16.085],
        [108.230, 16.025],
        [108.200, 16.025],
        [108.200, 16.085],
      ],
      26.92
    )
  );

  // Quận Sơn Trà
  places.push(
    makePolygon(
      'rel/2702',
      2702,
      'relation',
      'Quận Sơn Trà',
      'Quận Sơn Trà',
      'Son Tra District',
      6,
      'Quận',
      4,
      'district',
      { boundary: 'administrative' },
      [
        [108.235, 16.140],
        [108.310, 16.130],
        [108.260, 16.040],
        [108.235, 16.050],
        [108.235, 16.140],
      ],
      60.0
    )
  );

  // ==========================================
  // LEVEL 8: PHƯỜNG / XÃ / THỊ TRẤN
  // ==========================================

  // Phường Hàng Trống (Hoàn Kiếm, Hà Nội) - nơi có Hồ Gươm
  places.push(
    makePolygon(
      'rel/2801',
      2801,
      'relation',
      'Phường Hàng Trống',
      'Phường Hàng Trống',
      'Hang Trong Ward',
      8,
      'Phường',
      3,
      'ward',
      { boundary: 'administrative', place: 'suburb' },
      [
        [105.847, 21.033],
        [105.856, 21.033],
        [105.855, 21.026],
        [105.847, 21.026],
        [105.847, 21.033],
      ],
      0.35
    )
  );

  // Phường Tràng Tiền (Hoàn Kiếm, Hà Nội) - nơi có Nhà hát Lớn
  places.push(
    makePolygon(
      'rel/2802',
      2802,
      'relation',
      'Phường Tràng Tiền',
      'Phường Tràng Tiền',
      'Trang Tien Ward',
      8,
      'Phường',
      3,
      'ward',
      { boundary: 'administrative', place: 'suburb' },
      [
        [105.854, 21.027],
        [105.864, 21.027],
        [105.863, 21.020],
        [105.853, 21.020],
        [105.854, 21.027],
      ],
      0.38
    )
  );

  // Phường Điện Biên (Ba Đình, Hà Nội) - nơi có Lăng Bác
  places.push(
    makePolygon(
      'rel/2803',
      2803,
      'relation',
      'Phường Điện Biên',
      'Phường Điện Biên',
      'Dien Bien Ward',
      8,
      'Phường',
      3,
      'ward',
      { boundary: 'administrative', place: 'suburb' },
      [
        [105.830, 21.038],
        [105.842, 21.038],
        [105.840, 21.028],
        [105.830, 21.028],
        [105.830, 21.038],
      ],
      0.94
    )
  );

  // Phường Bến Nghé (Quận 1, TP. HCM) - Nhà thờ Đức Bà, Bưu điện, Dinh Độc Lập
  places.push(
    makePolygon(
      'rel/2804',
      2804,
      'relation',
      'Phường Bến Nghé',
      'Phường Bến Nghé',
      'Ben Nghe Ward',
      8,
      'Phường',
      3,
      'ward',
      { boundary: 'administrative', place: 'suburb' },
      [
        [106.694, 10.784],
        [106.708, 10.781],
        [106.707, 10.771],
        [106.693, 10.774],
        [106.694, 10.784],
      ],
      2.48
    )
  );

  // Phường Bến Thành (Quận 1, TP. HCM) - Chợ Bến Thành
  places.push(
    makePolygon(
      'rel/2805',
      2805,
      'relation',
      'Phường Bến Thành',
      'Phường Bến Thành',
      'Ben Thanh Ward',
      8,
      'Phường',
      3,
      'ward',
      { boundary: 'administrative', place: 'suburb' },
      [
        [106.688, 10.777],
        [106.698, 10.775],
        [106.696, 10.767],
        [106.687, 10.769],
        [106.688, 10.777],
      ],
      0.93
    )
  );

  // Phường 22 (Bình Thạnh, TP. HCM) - Landmark 81
  places.push(
    makePolygon(
      'rel/2806',
      2806,
      'relation',
      'Phường 22',
      'Phường 22',
      'Ward 22',
      8,
      'Phường',
      3,
      'ward',
      { boundary: 'administrative', place: 'suburb' },
      [
        [106.714, 10.798],
        [106.726, 10.795],
        [106.723, 10.786],
        [106.712, 10.788],
        [106.714, 10.798],
      ],
      1.75
    )
  );

  // Phường Phước Ninh (Hải Châu, Đà Nẵng) - Cầu Rồng
  places.push(
    makePolygon(
      'rel/2807',
      2807,
      'relation',
      'Phường Phước Ninh',
      'Phường Phước Ninh',
      'Phuoc Ninh Ward',
      8,
      'Phường',
      3,
      'ward',
      { boundary: 'administrative', place: 'suburb' },
      [
        [108.216, 16.064],
        [108.225, 16.063],
        [108.224, 16.056],
        [108.215, 16.057],
        [108.216, 16.064],
      ],
      0.47
    )
  );

  // ==========================================
  // LEVEL 1 / POIs & LANDMARKS (NỔI TIẾNG)
  // ==========================================

  // Hồ Hoàn Kiếm (Hồ Gươm)
  places.push(
    makePoint(
      'node/10001',
      10001,
      'Hồ Hoàn Kiếm (Hồ Gươm)',
      'Hồ Hoàn Kiếm',
      'Hoan Kiem Lake',
      {
        natural: 'water',
        water: 'lake',
        tourism: 'attraction',
        wikidata: 'Q648719',
      },
      105.8524,
      21.0287
    )
  );

  // Nhà hát Lớn Hà Nội
  places.push(
    makePoint(
      'node/10002',
      10002,
      'Nhà hát Lớn Hà Nội',
      'Nhà hát Lớn Hà Nội',
      'Hanoi Opera House',
      {
        amenity: 'theatre',
        building: 'theatre',
        tourism: 'attraction',
        wikidata: 'Q2633010',
      },
      105.8576,
      21.0244
    )
  );

  // Lăng Chủ tịch Hồ Chí Minh
  places.push(
    makePoint(
      'node/10003',
      10003,
      'Lăng Chủ tịch Hồ Chí Minh',
      'Lăng Chủ tịch Hồ Chí Minh',
      'Ho Chi Minh Mausoleum',
      {
        historic: 'memorial',
        tourism: 'attraction',
        wikidata: 'Q1143896',
      },
      105.8347,
      21.0368
    )
  );

  // Chợ Bến Thành (TP. HCM)
  places.push(
    makePoint(
      'node/10004',
      10004,
      'Chợ Bến Thành',
      'Chợ Bến Thành',
      'Ben Thanh Market',
      {
        amenity: 'marketplace',
        tourism: 'attraction',
        shop: 'mall',
        wikidata: 'Q816644',
      },
      106.6983,
      10.7725
    )
  );

  // ==========================================
  // RANH GIỚI NHÀ CỬA / TÒA NHÀ / CÔNG TRÌNH (BUILDING FOOTPRINTS)
  // PriorityRank = 0.5 (Cấp công trình - Chi tiết nhất trong chuỗi phân cấp địa lý)
  // ==========================================

  // 1. Tòa nhà Landmark 81 (TP. Hồ Chí Minh) - Đa giác chân tháp Landmark 81
  places.push(
    makeBuildingPolygon(
      'way/20001',
      20001,
      'Tòa nhà Landmark 81',
      'Tòa nhà Landmark 81',
      'Vincom Landmark 81',
      'Tòa nhà chọc trời (Skyscraper)',
      {
        building: 'skyscraper',
        'building:levels': '81',
        height: '461.2 m',
        'addr:housenumber': '720A',
        'addr:street': 'Điện Biên Phủ',
        'addr:subdistrict': 'Phường 22',
        'addr:district': 'Quận Bình Thạnh',
        'addr:city': 'Thành phố Hồ Chí Minh',
        operator: 'Vinhomes / Vingroup',
        tourism: 'attraction',
        wikidata: 'Q19894451',
      },
      [
        [106.7214, 10.7946],
        [106.7222, 10.7946],
        [106.7223, 10.7954],
        [106.7215, 10.7954],
        [106.7214, 10.7946],
      ],
      0.00008
    )
  );

  // 2. Tòa nhà Keangnam Hanoi Landmark 72 (Hà Nội) - Đa giác chân tháp Keangnam 72
  places.push(
    makeBuildingPolygon(
      'way/20002',
      20002,
      'Tòa nhà Keangnam Hanoi Landmark 72',
      'Tòa nhà Keangnam Hanoi Landmark 72',
      'Keangnam Hanoi Landmark Tower',
      'Tòa nhà văn phòng & Thương mại (Commercial)',
      {
        building: 'commercial',
        'building:levels': '72',
        height: '350 m',
        'addr:housenumber': '72',
        'addr:street': 'Phạm Hùng',
        'addr:subdistrict': 'Phường Mễ Trì',
        'addr:district': 'Quận Nam Từ Liêm',
        'addr:city': 'Thành phố Hà Nội',
        operator: 'Keangnam Enterprise / AON Holdings',
      },
      [
        [105.7832, 21.0164],
        [105.7844, 21.0164],
        [105.7844, 21.0174],
        [105.7832, 21.0174],
        [105.7832, 21.0164],
      ],
      0.00012
    )
  );

  // 3. Nhà Hát Lớn Hà Nội (Hà Nội) - Đa giác chân công trình kiến trúc Pháp
  places.push(
    makeBuildingPolygon(
      'way/20003',
      20003,
      'Nhà Hát Lớn Hà Nội',
      'Nhà Hát Lớn Hà Nội',
      'Hanoi Opera House',
      'Công trình Văn hóa / Nhà hát (Theatre)',
      {
        building: 'theatre',
        historic: 'yes',
        'addr:housenumber': '1',
        'addr:street': 'Tràng Tiền',
        'addr:subdistrict': 'Phường Tràng Tiền',
        'addr:district': 'Quận Hoàn Kiếm',
        'addr:city': 'Thành phố Hà Nội',
        tourism: 'attraction',
        wikidata: 'Q628867',
      },
      [
        [105.8572, 21.0240],
        [105.8580, 21.0240],
        [105.8580, 21.0248],
        [105.8572, 21.0248],
        [105.8572, 21.0240],
      ],
      0.00006
    )
  );

  // 4. Nhà số 12 Phố Tràng Tiền (Hà Nội) - Ranh giới nhà phố thương mại
  places.push(
    makeBuildingPolygon(
      'way/20004',
      20004,
      'Số 12 Phố Tràng Tiền',
      'Số 12 Phố Tràng Tiền',
      '12 Trang Tien Street Building',
      'Nhà phố thương mại / Cửa hàng (Retail/Shop)',
      {
        building: 'retail',
        'building:levels': '4',
        'addr:housenumber': '12',
        'addr:street': 'Tràng Tiền',
        'addr:subdistrict': 'Phường Tràng Tiền',
        'addr:district': 'Quận Hoàn Kiếm',
        'addr:city': 'Thành phố Hà Nội',
        shop: 'books',
      },
      [
        [105.8537, 21.0253],
        [105.8543, 21.0253],
        [105.8543, 21.0257],
        [105.8537, 21.0257],
        [105.8537, 21.0253],
      ],
      0.00002
    )
  );

  // 5. Dinh Độc Lập / Hội trường Thống Nhất (TP. Hồ Chí Minh) - Đa giác công trình
  places.push(
    makeBuildingPolygon(
      'way/20005',
      20005,
      'Dinh Độc Lập (Hội trường Thống Nhất)',
      'Dinh Độc Lập',
      'Independence Palace',
      'Công trình Lịch sử / Tòa thị chính (Public/Palace)',
      {
        building: 'public',
        historic: 'palace',
        'addr:housenumber': '135',
        'addr:street': 'Nam Kỳ Khởi Nghĩa',
        'addr:subdistrict': 'Phường Bến Nghé',
        'addr:district': 'Quận 1',
        'addr:city': 'Thành phố Hồ Chí Minh',
        tourism: 'attraction',
        wikidata: 'Q628867',
      },
      [
        [106.6946, 10.7764],
        [106.6960, 10.7764],
        [106.6960, 10.7776],
        [106.6946, 10.7776],
        [106.6946, 10.7764],
      ],
      0.00015
    )
  );

  // 6. Tòa nhà Bitexco Financial Tower (TP. Hồ Chí Minh) - Đa giác chân tháp búp sen
  places.push(
    makeBuildingPolygon(
      'way/20006',
      20006,
      'Tòa nhà Bitexco Financial Tower',
      'Tòa nhà Bitexco Financial Tower',
      'Bitexco Financial Tower',
      'Tòa nhà chọc trời / Thương mại (Skyscraper)',
      {
        building: 'skyscraper',
        'building:levels': '68',
        height: '262.5 m',
        'addr:housenumber': '2',
        'addr:street': 'Hải Triều',
        'addr:subdistrict': 'Phường Bến Nghé',
        'addr:district': 'Quận 1',
        'addr:city': 'Thành phố Hồ Chí Minh',
        tourism: 'attraction',
      },
      [
        [106.7038, 10.7712],
        [106.7046, 10.7712],
        [106.7046, 10.7720],
        [106.7038, 10.7720],
        [106.7038, 10.7712],
      ],
      0.00007
    )
  );

  // 7. Trung tâm Hành chính Thành phố Đà Nẵng (Đà Nẵng) - Đa giác tòa nhà bắp ngô
  places.push(
    makeBuildingPolygon(
      'way/20007',
      20007,
      'Trung tâm Hành chính Thành phố Đà Nẵng',
      'Trung tâm Hành chính Thành phố Đà Nẵng',
      'Danang City Administrative Center',
      'Tòa nhà Cơ quan Nhà nước (Government)',
      {
        building: 'government',
        'building:levels': '37',
        height: '166.8 m',
        'addr:housenumber': '24',
        'addr:street': 'Trần Phú',
        'addr:subdistrict': 'Phường Thạch Thang',
        'addr:district': 'Quận Hải Châu',
        'addr:city': 'Thành phố Đà Nẵng',
      },
      [
        [108.2230, 16.0743],
        [108.2240, 16.0743],
        [108.2240, 16.0753],
        [108.2230, 16.0753],
        [108.2230, 16.0743],
      ],
      0.00009
    )
  );

  // 8. Cung Văn hóa Hữu nghị Việt - Xô (Hà Nội) - Đa giác công trình
  places.push(
    makeBuildingPolygon(
      'way/20008',
      20008,
      'Cung Văn hóa Lao động Hữu nghị Việt - Xô',
      'Cung Văn hóa Hữu nghị Việt - Xô',
      'Viet Xo Friendship Labour Cultural Palace',
      'Tòa nhà Công cộng / Sự kiện (Civic/Public)',
      {
        building: 'civic',
        'addr:housenumber': '91',
        'addr:street': 'Trần Hưng Đạo',
        'addr:subdistrict': 'Phường Cửa Nam',
        'addr:district': 'Quận Hoàn Kiếm',
        'addr:city': 'Thành phố Hà Nội',
      },
      [
        [105.8435, 21.0227],
        [105.8447, 21.0227],
        [105.8447, 21.0237],
        [105.8435, 21.0237],
        [105.8435, 21.0227],
      ],
      0.00010
    )
  );

  // Cầu Rồng Đà Nẵng
  places.push(
    makePoint(
      'node/10007',
      10007,
      'Cầu Rồng Đà Nẵng',
      'Cầu Rồng',
      'Dragon Bridge',
      {
        bridge: 'yes',
        highway: 'primary',
        tourism: 'attraction',
        wikidata: 'Q10752107',
      },
      108.2274,
      16.0610
    )
  );

  // Đại Nội Huế (Kinh thành Huế)
  places.push(
    makePoint(
      'node/10008',
      10008,
      'Đại Nội Huế (Hoàng thành Huế)',
      'Đại Nội Huế',
      'Imperial City, Hue',
      {
        historic: 'castle',
        tourism: 'attraction',
        heritage: 'UNESCO',
        wikidata: 'Q1974163',
      },
      107.5786,
      16.4697
    )
  );

  // Vịnh Hạ Long (Điểm tham quan)
  places.push(
    makePoint(
      'node/10009',
      10009,
      'Vịnh Hạ Long',
      'Vịnh Hạ Long',
      'Ha Long Bay',
      {
        natural: 'bay',
        tourism: 'attraction',
        heritage: 'UNESCO',
        wikidata: 'Q190128',
      },
      107.1839,
      20.9101
    )
  );

  // Chợ nổi Cái Răng (Cần Thơ)
  places.push(
    makePoint(
      'node/10010',
      10010,
      'Chợ nổi Cái Răng',
      'Chợ nổi Cái Răng',
      'Cai Rang Floating Market',
      {
        amenity: 'marketplace',
        tourism: 'attraction',
      },
      105.7483,
      10.0052
    )
  );

  return places;
}
