import React, { useState } from 'react';
import { Code, Copy, Check, Play, Globe, Terminal, FileText, CheckCircle2, Building2, Layers } from 'lucide-react';

export const ApiDocsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'lookup' | 'building_select'>('lookup');

  // Lookup state
  const [testLat, setTestLat] = useState('21.0287');
  const [testLon, setTestLon] = useState('105.8524');
  const [testOrder, setTestOrder] = useState<'narrow_to_broad' | 'broad_to_narrow'>('narrow_to_broad');

  // Building select state
  const [selectCoordinatesJson, setSelectCoordinatesJson] = useState(
    JSON.stringify(
      [
        [106.7210, 10.7940],
        [106.7230, 10.7940],
        [106.7230, 10.7960],
        [106.7210, 10.7960],
      ],
      null,
      2
    )
  );

  const [apiResponse, setApiResponse] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeCodeLang, setActiveCodeLang] = useState<'curl' | 'js' | 'python'>('curl');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const executeLiveTest = async () => {
    setIsExecuting(true);
    try {
      if (activeTab === 'lookup') {
        const res = await fetch(`/api/lookup?lat=${testLat}&lon=${testLon}&order=${testOrder}`);
        const data = await res.json();
        setApiResponse(JSON.stringify(data, null, 2));
      } else {
        let parsedCoords;
        try {
          parsedCoords = JSON.parse(selectCoordinatesJson);
        } catch {
          setApiResponse(JSON.stringify({ success: false, error: 'JSON toạ độ không hợp lệ.' }, null, 2));
          return;
        }

        const res = await fetch('/api/buildings/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coordinates: parsedCoords }),
        });
        const data = await res.json();
        setApiResponse(JSON.stringify(data, null, 2));
      }
    } catch (e: any) {
      setApiResponse(JSON.stringify({ error: e.message }, null, 2));
    } finally {
      setIsExecuting(false);
    }
  };

  const setBuildingPreset = (preset: 'landmark' | 'bitexco' | 'hanoi') => {
    if (preset === 'landmark') {
      setSelectCoordinatesJson(
        JSON.stringify(
          [
            [106.7210, 10.7940],
            [106.7230, 10.7940],
            [106.7230, 10.7960],
            [106.7210, 10.7960],
          ],
          null,
          2
        )
      );
    } else if (preset === 'bitexco') {
      setSelectCoordinatesJson(
        JSON.stringify(
          [
            [106.7035, 10.7710],
            [106.7050, 10.7710],
            [106.7050, 10.7725],
            [106.7035, 10.7725],
          ],
          null,
          2
        )
      );
    } else if (preset === 'hanoi') {
      setSelectCoordinatesJson(
        JSON.stringify(
          [
            [105.8570, 21.0240],
            [105.8585, 21.0240],
            [105.8585, 21.0250],
            [105.8570, 21.0250],
          ],
          null,
          2
        )
      );
    }
  };

  const getCurlSnippet = () => {
    if (activeTab === 'lookup') {
      return `# 1. Phương thức GET
curl -X GET "https://your-domain.com/api/lookup?lat=${testLat}&lon=${testLon}&order=${testOrder}" \\
  -H "Accept: application/json"

# 2. Phương thức POST
curl -X POST "https://your-domain.com/api/lookup" \\
  -H "Content-Type: application/json" \\
  -d '{
    "lat": ${testLat},
    "lon": ${testLon},
    "order": "${testOrder}"
  }'`;
    }

    return `# Lựa chọn tòa nhà theo polygon vùng chọn (POST /api/buildings/select)
curl -X POST "https://your-domain.com/api/buildings/select" \\
  -H "Content-Type: application/json" \\
  -d '{
    "coordinates": ${selectCoordinatesJson.split('\n').join('\n    ')}
  }'`;
  };

  const getJsSnippet = () => {
    if (activeTab === 'lookup') {
      return `// JavaScript / TypeScript (Fetch API) - Reverse Geocode
async function getOsmHierarchy(lat, lon, order = 'narrow_to_broad') {
  const response = await fetch(
    \`/api/lookup?lat=\${lat}&lon=\${lon}&order=\${order}\`
  );
  
  if (!response.ok) {
    throw new Error('Geocoding query failed');
  }
  
  const result = await response.json();
  console.log('Tổng số địa điểm bao chứa:', result.data.totalFound);
  console.log('Đường dẫn hành chính:', result.data.fullPath.join(' ➔ '));
  return result.data.places;
}

getOsmHierarchy(${testLat}, ${testLon}).then(console.log);`;
    }

    return `// JavaScript / TypeScript (Fetch API) - Lựa chọn tòa nhà
async function selectBuildings(polygonCoordinates) {
  const response = await fetch('/api/buildings/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: polygonCoordinates })
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Building selection failed');
  }
  
  const result = await response.json();
  console.log('Số tòa nhà đạt ngưỡng >= 50%:', result.data.places.length);
  for (const b of result.data.places) {
    console.log(\`\${b.name} (Tỷ lệ phủ: \${(b.coverageRatio * 100).toFixed(1)}%)\`);
  }
  return result.data.places;
}

// Gọi thử:
selectBuildings(${selectCoordinatesJson}).then(console.log);`;
  };

  const getPythonSnippet = () => {
    if (activeTab === 'lookup') {
      return `import requests

def lookup_osm_hierarchy(lat, lon, order="narrow_to_broad"):
    url = "https://your-domain.com/api/lookup"
    params = {
        "lat": lat,
        "lon": lon,
        "order": order
    }
    
    response = requests.get(url, params=params)
    response.raise_for_status()
    data = response.json()["data"]
    
    print("Địa điểm phân cấp:")
    for i, place in enumerate(data["places"], 1):
        print(f"#{i} [{place['adminLevelLabel']}] {place['name']} (OSM: {place['id']})")
        
    return data

result = lookup_osm_hierarchy(${testLat}, ${testLon})`;
    }

    return `import requests

def select_buildings(coordinates):
    url = "https://your-domain.com/api/buildings/select"
    payload = {"coordinates": coordinates}
    
    response = requests.post(url, json=payload)
    response.raise_for_status()
    data = response.json()["data"]
    
    print(f"Tìm thấy {len(data['places'])} tòa nhà đạt ngưỡng >= 50%:")
    for bldg in data["places"]:
        ratio = bldg["coverageRatio"] * 100
        print(f"- {bldg['name']}: {ratio:.1f}% covered (ID: {bldg['id']})")
        
    return data["places"]

coords = ${selectCoordinatesJson}
buildings = select_buildings(coords)`;
  };

  const handleCopyCode = () => {
    let snippet = '';
    if (activeCodeLang === 'curl') snippet = getCurlSnippet();
    else if (activeCodeLang === 'js') snippet = getJsSnippet();
    else if (activeCodeLang === 'python') snippet = getPythonSnippet();

    navigator.clipboard.writeText(snippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Overview & Quick Spec */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Code className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-neutral-100">
              Tài liệu API Dữ liệu Không gian OpenStreetMap Việt Nam
            </h2>
            <p className="text-xs text-neutral-400">
              Cung cấp các API tra cứu toạ độ phân cấp hành chính và thuật toán lựa chọn tòa nhà theo tỷ lệ phủ không gian.
            </p>
          </div>
        </div>

        {/* Endpoints List Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
          <div
            onClick={() => setActiveTab('lookup')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
              activeTab === 'lookup'
                ? 'bg-neutral-800 border-amber-500/50 shadow-md ring-1 ring-amber-500/20'
                : 'bg-neutral-850 border-neutral-750 hover:bg-neutral-800'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[11px] font-bold">
                GET
              </span>
              <code className="text-xs text-neutral-200 font-mono">/api/lookup</code>
            </div>
            <p className="text-[11px] text-neutral-400">
              Tra cứu phân cấp theo toạ độ điểm: <code className="text-amber-400">?lat=...&lon=...</code>
            </p>
          </div>

          <div
            onClick={() => setActiveTab('lookup')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
              activeTab === 'lookup'
                ? 'bg-neutral-800 border-amber-500/50 shadow-md ring-1 ring-amber-500/20'
                : 'bg-neutral-850 border-neutral-750 hover:bg-neutral-800'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono text-[11px] font-bold">
                POST
              </span>
              <code className="text-xs text-neutral-200 font-mono">/api/lookup</code>
            </div>
            <p className="text-[11px] text-neutral-400">
              Tra cứu phân cấp qua JSON body: <code className="text-amber-400">{`{"lat": ..., "lon": ...}`}</code>
            </p>
          </div>

          <div
            onClick={() => setActiveTab('building_select')}
            className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
              activeTab === 'building_select'
                ? 'bg-neutral-800 border-amber-500/50 shadow-md ring-1 ring-amber-500/20'
                : 'bg-neutral-850 border-neutral-750 hover:bg-neutral-800'
            }`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-[11px] font-bold">
                POST
              </span>
              <code className="text-xs text-neutral-200 font-mono">/api/buildings/select</code>
            </div>
            <p className="text-[11px] text-neutral-400">
              Chọn tòa nhà theo tỷ lệ phủ: <code className="text-purple-300">coverageRatio &gt;= 0.5</code>
            </p>
          </div>
        </div>
      </div>

      {/* Interactive API Tester */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4 border-b border-neutral-800 pb-3">
          <h3 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-amber-400" />
            <span>Thử nghiệm trực tiếp Endpoint (Interactive API Console)</span>
          </h3>

          <div className="flex bg-neutral-800 p-0.5 rounded-lg border border-neutral-700">
            <button
              onClick={() => setActiveTab('lookup')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'lookup'
                  ? 'bg-amber-500 text-neutral-950 font-bold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              /api/lookup
            </button>
            <button
              onClick={() => setActiveTab('building_select')}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                activeTab === 'building_select'
                  ? 'bg-amber-500 text-neutral-950 font-bold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              /api/buildings/select
            </button>
          </div>
        </div>

        {activeTab === 'lookup' ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">lat (Vĩ độ)</label>
              <input
                type="text"
                value={testLat}
                onChange={(e) => setTestLat(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">lon (Kinh độ)</label>
              <input
                type="text"
                value={testLon}
                onChange={(e) => setTestLon(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">order (Thứ tự phân cấp)</label>
              <select
                value={testOrder}
                onChange={(e) => setTestOrder(e.target.value as any)}
                className="w-full px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100"
              >
                <option value="narrow_to_broad">Hẹp đến Rộng (Nhà ➔ Phường ➔ Quận ➔ TP)</option>
                <option value="broad_to_narrow">Rộng đến Hẹp (Quốc gia ➔ TP ➔ Quận ➔ Phường)</option>
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <label className="block text-[11px] text-neutral-400">
                coordinates (Mảng toạ độ polygon [kinh độ lon, vĩ độ lat])
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-neutral-500">Mẫu:</span>
                <button
                  type="button"
                  onClick={() => setBuildingPreset('landmark')}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-750 text-[10px] text-amber-300 rounded border border-neutral-700"
                >
                  Landmark 81
                </button>
                <button
                  type="button"
                  onClick={() => setBuildingPreset('bitexco')}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-750 text-[10px] text-amber-300 rounded border border-neutral-700"
                >
                  Bitexco Q1
                </button>
                <button
                  type="button"
                  onClick={() => setBuildingPreset('hanoi')}
                  className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-750 text-[10px] text-amber-300 rounded border border-neutral-700"
                >
                  Nhà Hát Lớn HN
                </button>
              </div>
            </div>
            <textarea
              rows={6}
              value={selectCoordinatesJson}
              onChange={(e) => setSelectCoordinatesJson(e.target.value)}
              className="w-full p-3 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 font-mono leading-relaxed"
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mb-4">
          <button
            onClick={executeLiveTest}
            disabled={isExecuting}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isExecuting ? 'Đang truy vấn...' : 'Gửi yêu cầu thử nghiệm'}</span>
          </button>
          <span className="text-[11px] text-neutral-500 font-mono">
            {activeTab === 'lookup'
              ? `GET /api/lookup?lat=${testLat}&lon=${testLon}&order=${testOrder}`
              : `POST /api/buildings/select`}
          </span>
        </div>

        {apiResponse && (
          <div className="mt-4 pt-4 border-t border-neutral-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-neutral-300">Phản hồi JSON thực tế:</span>
              <button
                onClick={() => setApiResponse(null)}
                className="text-[10px] text-neutral-500 hover:text-neutral-300"
              >
                Xóa
              </button>
            </div>
            <pre className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 text-xs font-mono text-neutral-200 overflow-x-auto max-h-72">
              {apiResponse}
            </pre>
          </div>
        )}
      </div>

      {/* Code Snippets Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>Mã mẫu tích hợp Client ({activeTab === 'lookup' ? '/api/lookup' : '/api/buildings/select'})</span>
          </h3>

          <div className="flex items-center gap-1 bg-neutral-800 p-0.5 rounded-lg border border-neutral-700">
            {(['curl', 'js', 'python'] as const).map((lang) => (
              <button
                key={lang}
                onClick={() => setActiveCodeLang(lang)}
                className={`px-3 py-1 rounded text-xs font-medium uppercase transition-colors ${
                  activeCodeLang === lang
                    ? 'bg-neutral-700 text-neutral-100 shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        {/* Code Block Container */}
        <div className="relative">
          <button
            onClick={handleCopyCode}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-750 text-neutral-300 text-xs font-medium border border-neutral-700 transition-colors z-10"
          >
            {copiedSnippet ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSnippet ? 'Đã sao chép' : 'Sao chép mã'}</span>
          </button>

          <pre className="p-4 bg-neutral-950 rounded-xl border border-neutral-800 text-xs font-mono text-emerald-300 overflow-x-auto leading-relaxed">
            {activeCodeLang === 'curl' && getCurlSnippet()}
            {activeCodeLang === 'js' && getJsSnippet()}
            {activeCodeLang === 'python' && getPythonSnippet()}
          </pre>
        </div>
      </div>

      {/* Building Selection Contract & Specification */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-purple-400" />
          <span>Đặc tả kỹ thuật API Lựa chọn Tòa nhà (POST /api/buildings/select)</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-neutral-850 p-4 rounded-xl border border-neutral-750 space-y-2">
            <h4 className="font-bold text-amber-400">Tiêu chuẩn tính toán tỷ lệ phủ</h4>
            <p className="text-neutral-300 leading-relaxed">
              <code className="text-emerald-300 font-mono">coverageRatio = area(intersection(selection, building)) / area(building)</code>
            </p>
            <ul className="list-disc list-inside space-y-1 text-neutral-400">
              <li><strong className="text-neutral-200">Ngưỡng:</strong> Chọn mọi tòa nhà có <code className="text-purple-300">coverageRatio &gt;= 0.5</code>.</li>
              <li><strong className="text-neutral-200">Mẫu số:</strong> Diện tích của chính tòa nhà (không phải diện tích vùng chọn).</li>
              <li><strong className="text-neutral-200">Geometry trả về:</strong> Giữ nguyên đường bao tòa nhà gốc của OSM (không trả phần giao).</li>
              <li><strong className="text-neutral-200">Thứ tự sắp xếp:</strong> Tỷ lệ phủ giảm dần, diện tích giao giảm dần, ID tăng dần.</li>
            </ul>
          </div>

          <div className="bg-neutral-850 p-4 rounded-xl border border-neutral-750 space-y-2">
            <h4 className="font-bold text-amber-400">Bảng mã phản hồi HTTP</h4>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-1">
                <span className="text-emerald-400 font-bold">200 OK</span>
                <span className="text-neutral-300">Thành công, trả danh sách (places: [] nếu không có nhà)</span>
              </div>
              <div className="flex items-center justify-between border-b border-neutral-800 pb-1">
                <span className="text-amber-400 font-bold">400 Bad Request</span>
                <span className="text-neutral-300">Toạ độ sai kiểu, ít hơn 3 đỉnh, tự cắt, thẳng hàng</span>
              </div>
              <div className="flex items-center justify-between border-b border-neutral-800 pb-1">
                <span className="text-rose-400 font-bold">413 Too Large</span>
                <span className="text-neutral-300">Payload body vượt quá 1MB</span>
              </div>
              <div className="flex items-center justify-between border-b border-neutral-800 pb-1">
                <span className="text-purple-400 font-bold">422 Unprocessable</span>
                <span className="text-neutral-300">Vùng chọn vượt 25 km² hoặc số ứng viên &gt; 3000</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-red-400 font-bold">503 Unavailable</span>
                <span className="text-neutral-300">Cơ sở dữ liệu PostgreSQL tạm thời không khả dụng</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Response Schema & OSM Admin Level Table */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-neutral-100 flex items-center gap-2">
          <Layers className="w-4 h-4 text-blue-400" />
          <span>Quy chuẩn phân cấp hành chính OSM tại Việt Nam (admin_level)</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="text-[11px] text-neutral-400 uppercase bg-neutral-800/80 border-b border-neutral-750">
              <tr>
                <th className="px-3 py-2">Thẻ OSM (admin_level)</th>
                <th className="px-3 py-2">Cấp hành chính Việt Nam</th>
                <th className="px-3 py-2">Ưu tiên (Priority Rank)</th>
                <th className="px-3 py-2">Ví dụ thực tế</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 font-mono text-neutral-300">
              <tr className="hover:bg-neutral-850/50 bg-amber-500/10">
                <td className="px-3 py-2.5 text-amber-300 font-bold flex items-center gap-1">
                  <span>🏠</span> building=*
                </td>
                <td className="px-3 py-2.5 font-sans font-semibold text-amber-200">
                  Ranh giới nhà cửa / Tòa nhà (Building Footprint Polygon)
                </td>
                <td className="px-3 py-2.5 text-emerald-400 font-bold">0.5 (Ưu tiên tuyệt đối cao nhất)</td>
                <td className="px-3 py-2.5 font-sans">Landmark 81, Keangnam 72, Nhà hát Thành phố</td>
              </tr>
              <tr className="hover:bg-neutral-850/50">
                <td className="px-3 py-2.5 text-amber-400 font-bold">poi / amenity</td>
                <td className="px-3 py-2.5 font-sans">Địa điểm, Tiện ích lân cận</td>
                <td className="px-3 py-2.5 text-emerald-400 font-bold">1</td>
                <td className="px-3 py-2.5 font-sans">Hồ Gươm, Chợ Bến Thành</td>
              </tr>
              <tr className="hover:bg-neutral-850/50">
                <td className="px-3 py-2.5 text-amber-400 font-bold">admin_level=8</td>
                <td className="px-3 py-2.5 font-sans">Phường, Xã, Thị trấn</td>
                <td className="px-3 py-2.5 text-emerald-400 font-bold">3</td>
                <td className="px-3 py-2.5 font-sans">Phường Hàng Trống, Phường Bến Nghé</td>
              </tr>
              <tr className="hover:bg-neutral-850/50">
                <td className="px-3 py-2.5 text-amber-400 font-bold">admin_level=6</td>
                <td className="px-3 py-2.5 font-sans">Quận, Huyện, Thị xã, TP thuộc tỉnh</td>
                <td className="px-3 py-2.5 text-emerald-400 font-bold">4</td>
                <td className="px-3 py-2.5 font-sans">Quận Hoàn Kiếm, Quận 1, TP. Thủ Đức</td>
              </tr>
              <tr className="hover:bg-neutral-850/50">
                <td className="px-3 py-2.5 text-amber-400 font-bold">admin_level=4</td>
                <td className="px-3 py-2.5 font-sans">Tỉnh, Thành phố trực thuộc Trung ương</td>
                <td className="px-3 py-2.5 text-emerald-400 font-bold">5</td>
                <td className="px-3 py-2.5 font-sans">TP. Hà Nội, TP. Hồ Chí Minh, TP. Đà Nẵng</td>
              </tr>
              <tr className="hover:bg-neutral-850/50">
                <td className="px-3 py-2.5 text-amber-400 font-bold">admin_level=3</td>
                <td className="px-3 py-2.5 font-sans">Vùng kinh tế / Vùng địa lý</td>
                <td className="px-3 py-2.5 text-emerald-400 font-bold">6</td>
                <td className="px-3 py-2.5 font-sans">Đồng bằng sông Hồng, Đông Nam Bộ</td>
              </tr>
              <tr className="hover:bg-neutral-850/50">
                <td className="px-3 py-2.5 text-amber-400 font-bold">admin_level=2</td>
                <td className="px-3 py-2.5 font-sans">Quốc gia</td>
                <td className="px-3 py-2.5 text-emerald-400 font-bold">7</td>
                <td className="px-3 py-2.5 font-sans">Việt Nam</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
