import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { app } from '../server';

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(() => {
  server.close();
});

test('POST /api/buildings/select - 400 Bad Request on invalid body formats', async () => {
  // 1. Empty body
  const res1 = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res1.status, 400);
  const data1 = await res1.json();
  assert.equal(data1.success, false);
  assert.ok(data1.error);

  // 2. Non-array coordinates
  const res2 = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: 'invalid' }),
  });
  assert.equal(res2.status, 400);

  // 3. String coordinates (no string coercion)
  const res3 = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coordinates: [
        ['106.7', 10.7],
        [106.71, 10.7],
        [106.71, 10.71],
      ],
    }),
  });
  assert.equal(res3.status, 400);

  // 4. Self-intersecting coordinates (hourglass / figure 8)
  const res4 = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coordinates: [
        [106.7, 10.7],
        [106.71, 10.71],
        [106.7, 10.71],
        [106.71, 10.7],
      ],
    }),
  });
  assert.equal(res4.status, 400);
  const data4 = await res4.json();
  assert.ok(data4.error.includes('tự cắt'));

  // 5. Collinear points
  const res5 = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coordinates: [
        [106.7, 10.7],
        [106.71, 10.71],
        [106.72, 10.72],
      ],
    }),
  });
  assert.equal(res5.status, 400);
});

test('POST /api/buildings/select - 413 Payload Too Large on oversized body', async () => {
  // Generate dummy coordinates array > 1MB
  const largeArray = Array.from({ length: 45000 }, (_, i) => [
    106.7 + (i % 100) * 0.0001,
    10.7 + (i % 100) * 0.0001,
  ]);
  const payload = JSON.stringify({ coordinates: largeArray });
  assert.ok(Buffer.byteLength(payload) > 1024 * 1024, 'Payload should exceed 1MB');

  const res = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  assert.equal(res.status, 413);
  const data = await res.json();
  assert.equal(data.success, false);
});

test('POST /api/buildings/select - 422 Unprocessable Content when exceeding max area/span', async () => {
  // Polygon with span > 0.15 degrees (e.g. ~25km)
  const hugeArea = [
    [106.5, 10.5],
    [106.8, 10.5],
    [106.8, 10.8],
    [106.5, 10.8],
  ];

  const res = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: hugeArea }),
  });
  assert.equal(res.status, 422);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.ok(data.error.includes('giới hạn xử lý tối đa'));
});

test('POST /api/buildings/select - 200 OK with real DB buildings around Landmark 81', async () => {
  // Bounding box around Landmark 81 complex (Ho Chi Minh City)
  const landmark81Selection = [
    [106.7210, 10.7940],
    [106.7230, 10.7940],
    [106.7230, 10.7960],
    [106.7210, 10.7960],
  ];

  const res = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: landmark81Selection }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.data.places));

  // If DB is populated (which we verified has >1.2M buildings), verify places structure
  for (const place of data.data.places) {
    assert.ok(place.id);
    assert.equal(place.placeType, 'building');
    assert.ok(typeof place.coverageRatio === 'number');
    assert.ok(place.coverageRatio >= 0.5, `coverageRatio ${place.coverageRatio} must be >= 0.5`);
    assert.ok(place.coverageRatio <= 1.0, `coverageRatio ${place.coverageRatio} must be <= 1.0`);
    assert.ok(place.geometry);
    assert.ok(place.geometryType === 'Polygon' || place.geometryType === 'MultiPolygon');
  }

  // Verify sorting order: coverageRatio descending
  for (let i = 0; i < data.data.places.length - 1; i++) {
    assert.ok(
      data.data.places[i].coverageRatio >= data.data.places[i + 1].coverageRatio,
      'Must be sorted by coverageRatio descending'
    );
  }
});

test('POST /api/buildings/select - 200 OK with places: [] when no building is in selection', async () => {
  // Remote ocean coordinates off the coast of Vietnam where no buildings exist
  const oceanCoordinates = [
    [112.500, 10.000],
    [112.505, 10.000],
    [112.505, 10.005],
    [112.500, 10.005],
  ];

  const res = await fetch(`${baseUrl}/api/buildings/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: oceanCoordinates }),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.deepEqual(data.data.places, []);
});

test('getBuildingCandidatesForBbox: verifies candidate query and limit + 1 overflow detection', async () => {
  const { getBuildingCandidatesForBbox } = await import('../src/db/osmPlaces');

  const bbox = {
    minLon: 106.720,
    minLat: 10.793,
    maxLon: 106.724,
    maxLat: 10.797,
  };

  // With a small limit of 5 candidates in a dense area (Landmark 81 has >90 buildings)
  const overflowRes = await getBuildingCandidatesForBbox(bbox, 5);
  assert.equal(overflowRes.hasOverflow, true, 'hasOverflow must be true when candidates > limit');
  assert.equal(overflowRes.candidates.length, 5, 'Should truncate to limit');
  assert.ok(overflowRes.totalFetched > 5, 'Total fetched rows should be limit + 1 (6)');

  // With an ample limit of 500
  const ampleRes = await getBuildingCandidatesForBbox(bbox, 500);
  assert.equal(ampleRes.hasOverflow, false, 'hasOverflow must be false when limit is sufficient');
  assert.ok(ampleRes.candidates.length > 10, 'Should find multiple buildings around Landmark 81');

  // Verify all candidates have placeType === 'building' and valid polygon/multipolygon geometry
  for (const c of ampleRes.candidates) {
    assert.equal(c.placeType, 'building');
    assert.ok(c.geometryType === 'Polygon' || c.geometryType === 'MultiPolygon');
  }
});
