import React, { useState } from 'react';
import { Code, Copy, Check, Play, Globe, Terminal, FileText, CheckCircle2 } from 'lucide-react';

export const ApiDocsView: React.FC = () => {
  const [testLat, setTestLat] = useState('21.0287');
  const [testLon, setTestLon] = useState('105.8524');
  const [testOrder, setTestOrder] = useState<'narrow_to_broad' | 'broad_to_narrow'>('narrow_to_broad');
  const [apiResponse, setApiResponse] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeCodeLang, setActiveCodeLang] = useState<'curl' | 'js' | 'python'>('curl');
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const executeLiveTest = async () => {
    setIsExecuting(true);
    try {
      const res = await fetch(`/api/lookup?lat=${testLat}&lon=${testLon}&order=${testOrder}`);
      const data = await res.json();
      setApiResponse(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setApiResponse(JSON.stringify({ error: e.message }, null, 2));
    } finally {
      setIsExecuting(false);
    }
  };

  const getCurlSnippet = () => {
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
  };

  const getJsSnippet = () => {
    return `// JavaScript / TypeScript (Fetch API)
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
  
  // Danh sách sắp xếp theo ưu tiên
  return result.data.places;
}

// Gọi thử:
getOsmHierarchy(${testLat}, ${testLon}).then(console.log);`;
  };

  const getPythonSnippet = () => {
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

# Gọi thử:
result = lookup_osm_hierarchy(${testLat}, ${testLon})`;
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
              Tài liệu API Phân cấp Hành chính Toạ độ OSM
            </h2>
            <p className="text-xs text-neutral-400">
              API endpoint nhận đầu vào toạ độ (latitude, longitude) và trả về danh sách các địa điểm chứa toạ độ đó theo dữ liệu OpenStreetMap (PBF) Việt Nam.
            </p>
          </div>
        </div>

        {/* Endpoints List Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <div className="p-3.5 bg-neutral-850 rounded-xl border border-neutral-750">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[11px] font-bold">
                GET
              </span>
              <code className="text-xs text-neutral-200 font-mono">/api/lookup</code>
            </div>
            <p className="text-[11px] text-neutral-400">
              Truy vấn qua Query parameters: <code className="text-amber-400">?lat=...&lon=...&order=...</code>
            </p>
          </div>

          <div className="p-3.5 bg-neutral-850 rounded-xl border border-neutral-750">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono text-[11px] font-bold">
                POST
              </span>
              <code className="text-xs text-neutral-200 font-mono">/api/lookup</code>
            </div>
            <p className="text-[11px] text-neutral-400">
              Truy vấn qua JSON body: <code className="text-amber-400">{`{"lat": 21.0287, "lon": 105.8524}`}</code>
            </p>
          </div>
        </div>
      </div>

      {/* Interactive API Tester */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-sm font-bold text-neutral-100 mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-amber-400" />
          <span>Thử nghiệm trực tiếp Endpoint (Interactive API Console)</span>
        </h3>

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
            <label className="block text-[11px] text-neutral-400 mb-1">lon / lng (Kinh độ)</label>
            <input
              type="text"
              value={testLon}
              onChange={(e) => setTestLon(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] text-neutral-400 mb-1">order (Thứ tự ưu tiên)</label>
            <select
              value={testOrder}
              onChange={(e) => setTestOrder(e.target.value as any)}
              className="w-full px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100"
            >
              <option value="narrow_to_broad">narrow_to_broad (POI ➔ Phường ➔ Quận ➔ Tỉnh ➔ QG)</option>
              <option value="broad_to_narrow">broad_to_narrow (QG ➔ Tỉnh ➔ Quận ➔ Phường ➔ POI)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-run-api-test"
            onClick={executeLiveTest}
            disabled={isExecuting}
            className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isExecuting ? 'Đang gửi Request...' : 'Gửi Request thử nghiệm'}</span>
          </button>
        </div>

        {/* Live Response Box */}
        {apiResponse && (
          <div className="mt-4">
            <div className="flex items-center justify-between pb-1.5 text-xs text-neutral-400 border-b border-neutral-800">
              <span>Response JSON (Status: 200 OK):</span>
              <button
                onClick={() => navigator.clipboard.writeText(apiResponse)}
                className="text-[11px] text-amber-400 hover:text-amber-300"
              >
                Sao chép JSON
              </button>
            </div>
            <pre className="mt-2 p-3 bg-neutral-950 rounded-xl border border-neutral-800 text-[11px] font-mono text-neutral-200 overflow-x-auto max-h-72">
              {apiResponse}
            </pre>
          </div>
        )}
      </div>

      {/* Code Snippets Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-neutral-100">
              Đoạn mã tích hợp mẫu (Code Snippets)
            </h3>
          </div>

          <div className="flex items-center gap-1 bg-neutral-800 p-1 rounded-lg border border-neutral-700">
            <button
              onClick={() => setActiveCodeLang('curl')}
              className={`px-3 py-1 text-xs font-mono rounded ${
                activeCodeLang === 'curl' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-300'
              }`}
            >
              cURL
            </button>
            <button
              onClick={() => setActiveCodeLang('js')}
              className={`px-3 py-1 text-xs font-mono rounded ${
                activeCodeLang === 'js' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-300'
              }`}
            >
              JS / TypeScript
            </button>
            <button
              onClick={() => setActiveCodeLang('python')}
              className={`px-3 py-1 text-xs font-mono rounded ${
                activeCodeLang === 'python' ? 'bg-amber-500 text-neutral-950 font-bold' : 'text-neutral-300'
              }`}
            >
              Python
            </button>
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

      {/* Response Schema & OSM Admin Level Table */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-neutral-100">
          Quy chuẩn phân cấp hành chính OSM tại Việt Nam (admin_level)
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
