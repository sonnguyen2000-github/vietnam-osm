import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndNormalizeSelectionPolygon,
  calculateBuildingSelection,
  MAX_SELECTION_VERTICES,
} from '../server/buildingSelection';
import { OSMPlace } from '../server/types';

// Helper to create a dummy OSMPlace building
function createBuilding(
  id: string,
  coordinates: number[][][],
  multi?: number[][][][]
): OSMPlace {
  const isMulti = !!multi;
  const rings = isMulti ? multi!.flat() : coordinates;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return {
    id,
    osmId: parseInt(id.replace(/\D/g, ''), 10) || 1,
    osmType: 'way',
    name: `Building ${id}`,
    adminLevel: 'building',
    adminLevelLabel: 'Tòa nhà',
    priorityRank: 0.5,
    placeType: 'building',
    tags: { building: 'yes' },
    bbox: { minLon, minLat, maxLon, maxLat },
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
    geometryType: isMulti ? 'MultiPolygon' : 'Polygon',
    geometry: isMulti ? { coordinates: multi! } : { coordinates },
  };
}

test('validateAndNormalizeSelectionPolygon: checks basic validation rules', () => {
  // 1. Invalid input types
  assert.equal(validateAndNormalizeSelectionPolygon(null).valid, false);
  assert.equal(validateAndNormalizeSelectionPolygon('not an array').valid, false);
  assert.equal(validateAndNormalizeSelectionPolygon({}).valid, false);

  // 2. Too few vertices
  assert.equal(
    validateAndNormalizeSelectionPolygon([
      [106.7, 10.7],
      [106.71, 10.71],
    ]).valid,
    false
  );

  // 3. Invalid coordinate values (strings, non-finite, out of bounds)
  assert.equal(
    validateAndNormalizeSelectionPolygon([
      ['106.7', 10.7],
      [106.71, 10.71],
      [106.7, 10.71],
    ]).valid,
    false
  );

  assert.equal(
    validateAndNormalizeSelectionPolygon([
      [NaN, 10.7],
      [106.71, 10.71],
      [106.7, 10.71],
    ]).valid,
    false
  );

  assert.equal(
    validateAndNormalizeSelectionPolygon([
      [200, 10.7],
      [106.71, 10.71],
      [106.7, 10.71],
    ]).valid,
    false
  );

  // 4. Consecutive duplicates deduplicated & auto-closing
  const withDups = [
    [106.7, 10.7],
    [106.7, 10.7], // duplicate
    [106.71, 10.7],
    [106.71, 10.71],
    [106.7, 10.71],
  ];
  const resDups = validateAndNormalizeSelectionPolygon(withDups);
  assert.equal(resDups.valid, true);
  if (resDups.valid) {
    // Ring should be closed and duplicate removed: 4 distinct points + 1 closing point = 5
    assert.equal(resDups.ring.length, 5);
    assert.deepEqual(resDups.ring[0], resDups.ring[4]);
  }

  // 5. Collinear points (zero planar area) rejected
  const collinear = [
    [106.7, 10.7],
    [106.71, 10.71],
    [106.72, 10.72],
    [106.7, 10.7],
  ];
  const resCollinear = validateAndNormalizeSelectionPolygon(collinear);
  assert.equal(resCollinear.valid, false);

  // 6. Self-intersecting polygon (hourglass / figure 8) rejected
  const hourglass = [
    [106.7, 10.7],
    [106.71, 10.71],
    [106.7, 10.71],
    [106.71, 10.7],
    [106.7, 10.7],
  ];
  const resHourglass = validateAndNormalizeSelectionPolygon(hourglass);
  assert.equal(resHourglass.valid, false);

  // 7. Max vertices limit check
  const tooMany = Array.from({ length: MAX_SELECTION_VERTICES + 5 }, (_, i) => [
    106.7 + i * 0.00001,
    10.7 + i * 0.00001,
  ]);
  const resTooMany = validateAndNormalizeSelectionPolygon(tooMany);
  assert.equal(resTooMany.valid, false);
  assert.equal((resTooMany as any).statusCode, 422);

  // 8. Antimeridian crossing rejected
  const antimeridian = [
    [179.9, 10.0],
    [-179.9, 10.0],
    [-179.9, 10.1],
    [179.9, 10.1],
    [179.9, 10.0],
  ];
  const resAntimeridian = validateAndNormalizeSelectionPolygon(antimeridian);
  assert.equal(resAntimeridian.valid, false);
});

test('calculateBuildingSelection: Criteria 1 & 2 - Fully inside achieves 1.0, fully outside excluded', () => {
  // Selection box: [106.700, 10.770] to [106.710, 10.780]
  const selection = [
    [106.700, 10.770],
    [106.710, 10.770],
    [106.710, 10.780],
    [106.700, 10.780],
    [106.700, 10.770],
  ] as [number, number][];

  // Building 1: inside selection
  const bldgInside = createBuilding('way/1', [
    [
      [106.702, 10.772],
      [106.706, 10.772],
      [106.706, 10.776],
      [106.702, 10.776],
      [106.702, 10.772],
    ],
  ]);

  // Building 2: outside selection
  const bldgOutside = createBuilding('way/2', [
    [
      [106.720, 10.790],
      [106.724, 10.790],
      [106.724, 10.794],
      [106.720, 10.794],
      [106.720, 10.790],
    ],
  ]);

  const results = calculateBuildingSelection(selection, [bldgInside, bldgOutside]);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'way/1');
  assert.equal(results[0].coverageRatio, 1);
  // Preserves original building geometry
  assert.deepEqual(results[0].geometry, bldgInside.geometry);
});

test('calculateBuildingSelection: Criteria 3 - Precision threshold 49.9% excluded, 50.0% & 50.1% included', () => {
  // Building: unit square [106.7000, 10.7700] to [106.7010, 10.7710] (height: 0.0010)
  const baseBldg = [
    [106.7000, 10.7700],
    [106.7010, 10.7700],
    [106.7010, 10.7710],
    [106.7000, 10.7710],
    [106.7000, 10.7700],
  ];

  const bldg499 = createBuilding('way/499', [baseBldg]);
  const bldg500 = createBuilding('way/500', [baseBldg]);
  const bldg501 = createBuilding('way/501', [baseBldg]);

  // Selection covering exactly 49.9% of height (from 10.7700 to 10.770499)
  const sel499 = [
    [106.699, 10.7700],
    [106.702, 10.7700],
    [106.702, 10.770499],
    [106.699, 10.770499],
    [106.699, 10.7700],
  ] as [number, number][];

  // Selection covering exactly 50.0% of height (from 10.7700 to 10.7705)
  const sel500 = [
    [106.699, 10.7700],
    [106.702, 10.7700],
    [106.702, 10.7705],
    [106.699, 10.7705],
    [106.699, 10.7700],
  ] as [number, number][];

  // Selection covering 50.1% of height (from 10.7700 to 10.770501)
  const sel501 = [
    [106.699, 10.7700],
    [106.702, 10.7700],
    [106.702, 10.770501],
    [106.699, 10.770501],
    [106.699, 10.7700],
  ] as [number, number][];

  const res499 = calculateBuildingSelection(sel499, [bldg499]);
  assert.equal(res499.length, 0, '49.9% coverage must be excluded');

  const res500 = calculateBuildingSelection(sel500, [bldg500]);
  assert.equal(res500.length, 1, '50.0% coverage must be included');
  assert.ok(res500[0].coverageRatio >= 0.5);

  const res501 = calculateBuildingSelection(sel501, [bldg501]);
  assert.equal(res501.length, 1, '50.1% coverage must be included');
  assert.ok(res501[0].coverageRatio >= 0.5);
});

test('calculateBuildingSelection: Criteria 4 - Large building with small corner overlap (ratio < 50%) is excluded', () => {
  // Massive building: [106.70, 10.70] to [106.80, 10.80] (~11x11 km)
  const hugeBuilding = createBuilding('way/huge', [
    [
      [106.70, 10.70],
      [106.80, 10.70],
      [106.80, 10.80],
      [106.70, 10.80],
      [106.70, 10.70],
    ],
  ]);

  // Selection covering a corner (e.g. 50m x 50m)
  const cornerSelection = [
    [106.699, 10.699],
    [106.701, 10.699],
    [106.701, 10.701],
    [106.699, 10.701],
    [106.699, 10.699],
  ] as [number, number][];

  const res = calculateBuildingSelection(cornerSelection, [hugeBuilding]);
  assert.equal(res.length, 0, 'Large building with tiny corner coverage must not be selected');
});

test('calculateBuildingSelection: Criteria 5 & 6 - Multiple buildings & empty result when none >= 50%', () => {
  // Selection: [106.700, 10.770] to [106.708, 10.778]
  const selection = [
    [106.700, 10.770],
    [106.708, 10.770],
    [106.708, 10.778],
    [106.700, 10.778],
    [106.700, 10.770],
  ] as [number, number][];

  // bldg1: 100% covered
  const b1 = createBuilding('way/1', [
    [
      [106.701, 10.771],
      [106.703, 10.771],
      [106.703, 10.773],
      [106.701, 10.773],
      [106.701, 10.771],
    ],
  ]);

  // b2: ~75% covered
  const b2 = createBuilding('way/2', [
    [
      [106.706, 10.771],
      [106.710, 10.771], // 106.708 cuts at 50% lon
      [106.710, 10.773],
      [106.706, 10.773],
      [106.706, 10.771],
    ],
  ]);

  // b3: only ~20% covered
  const b3 = createBuilding('way/3', [
    [
      [106.706, 10.776],
      [106.716, 10.776], // wide building, only small part inside
      [106.716, 10.778],
      [106.706, 10.778],
      [106.706, 10.776],
    ],
  ]);

  const res = calculateBuildingSelection(selection, [b1, b2, b3]);
  assert.equal(res.length, 2, 'Only b1 and b2 should be selected');
  assert.equal(res[0].id, 'way/1');
  assert.equal(res[1].id, 'way/2');

  // Test when none >= 50%: only b3 provided
  const resNone = calculateBuildingSelection(selection, [b3]);
  assert.deepEqual(resNone, [], 'Should return empty array when none reaches 50%');
});

test('calculateBuildingSelection: Criteria 7 - Donut building with hole', () => {
  // Outer ring [106.700, 10.770] to [106.710, 10.780]
  // Inner hole [106.703, 10.773] to [106.707, 10.777]
  const donutBuilding = createBuilding('way/donut', [
    [
      [106.700, 10.770],
      [106.710, 10.770],
      [106.710, 10.780],
      [106.700, 10.780],
      [106.700, 10.770],
    ],
    [
      [106.703, 10.773],
      [106.707, 10.773],
      [106.707, 10.777],
      [106.703, 10.777],
      [106.703, 10.773],
    ],
  ]);

  // Selection completely inside the hole of the donut
  const insideHoleSelection = [
    [106.704, 10.774],
    [106.706, 10.774],
    [106.706, 10.776],
    [106.704, 10.776],
    [106.704, 10.774],
  ] as [number, number][];

  const res = calculateBuildingSelection(insideHoleSelection, [donutBuilding]);
  assert.equal(res.length, 0, 'Selection inside hole must have 0 coverage');
});

test('calculateBuildingSelection: Criteria 8 - MultiPolygon building and concave selection', () => {
  // MultiPolygon building: 2 distinct parts of equal size
  // Part 1: [106.700, 10.770] to [106.702, 10.772]
  // Part 2: [106.710, 10.770] to [106.712, 10.772]
  const mpBuilding = createBuilding(
    'way/mp',
    [],
    [
      [
        [
          [106.700, 10.770],
          [106.702, 10.770],
          [106.702, 10.772],
          [106.700, 10.772],
          [106.700, 10.770],
        ],
      ],
      [
        [
          [106.710, 10.770],
          [106.712, 10.770],
          [106.712, 10.772],
          [106.710, 10.772],
          [106.710, 10.770],
        ],
      ],
    ] as any
  );

  // Selection covering ONLY Part 1 completely (which is 50% of the entire MultiPolygon)
  const selPart1 = [
    [106.699, 10.769],
    [106.703, 10.769],
    [106.703, 10.773],
    [106.699, 10.773],
    [106.699, 10.769],
  ] as [number, number][];

  const res = calculateBuildingSelection(selPart1, [mpBuilding]);
  assert.equal(res.length, 1, '50% of MultiPolygon covered must be selected');
  assert.ok(Math.abs(res[0].coverageRatio - 0.5) < 0.01);
});

test('calculateBuildingSelection: Criteria 9 - Touching edge or vertex produces 0 area and is excluded', () => {
  // Building [106.700, 10.770] to [106.702, 10.772]
  const bldg = createBuilding('way/touch', [
    [
      [106.700, 10.770],
      [106.702, 10.770],
      [106.702, 10.772],
      [106.700, 10.772],
      [106.700, 10.770],
    ],
  ]);

  // Selection touching on the left edge [106.700, 10.770]-[106.700, 10.772]
  const touchEdgeSel = [
    [106.698, 10.770],
    [106.700, 10.770],
    [106.700, 10.772],
    [106.698, 10.772],
    [106.698, 10.770],
  ] as [number, number][];

  const resEdge = calculateBuildingSelection(touchEdgeSel, [bldg]);
  assert.equal(resEdge.length, 0, 'Touching edge must not be selected');

  // Selection touching at single vertex [106.700, 10.770]
  const touchVertexSel = [
    [106.698, 10.768],
    [106.700, 10.768],
    [106.700, 10.770],
    [106.698, 10.770],
    [106.698, 10.768],
  ] as [number, number][];

  const resVertex = calculateBuildingSelection(touchVertexSel, [bldg]);
  assert.equal(resVertex.length, 0, 'Touching vertex must not be selected');
});

test('calculateBuildingSelection: Stable sorting & deduplication', () => {
  // Building A: 80% coverage (width 0.010, selection cuts at 0.008 -> 80%)
  const bA = createBuilding('way/A', [
    [
      [106.700, 10.770],
      [106.710, 10.770],
      [106.710, 10.780],
      [106.700, 10.780],
      [106.700, 10.770],
    ],
  ]);

  // Building B: 100% coverage
  const bB = createBuilding('way/B', [
    [
      [106.702, 10.772],
      [106.704, 10.772],
      [106.704, 10.774],
      [106.702, 10.774],
      [106.702, 10.772],
    ],
  ]);

  // Building C: 80% coverage (from 106.704 to 106.709, width 0.005, selection cuts at 106.708 -> 0.004 width -> 80%)
  // Same 80% ratio as A, but smaller intersection area
  const bC = createBuilding('way/C', [
    [
      [106.704, 10.775],
      [106.709, 10.775],
      [106.709, 10.776],
      [106.704, 10.776],
      [106.704, 10.775],
    ],
  ]);

  const selection = [
    [106.699, 10.769],
    [106.708, 10.769],
    [106.708, 10.781],
    [106.699, 10.781],
    [106.699, 10.769],
  ] as [number, number][];

  // Pass duplicates of bA in candidates
  const results = calculateBuildingSelection(selection, [bC, bA, bB, bA]);

  // Must not have duplicate IDs
  assert.equal(results.length, 3);
  // 1st: bB (100%)
  assert.equal(results[0].id, 'way/B');
  // 2nd: bA (80%, larger area than bC)
  assert.equal(results[1].id, 'way/A');
  // 3rd: bC (80%, smaller area)
  assert.equal(results[2].id, 'way/C');
});
