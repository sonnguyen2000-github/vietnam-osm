import React, { useState } from 'react';
import {
  Search,
  MapPin,
  Clock,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Tag,
  Globe2,
  Building,
  Landmark,
  Compass,
  ArrowUpDown,
  Info,
} from 'lucide-react';
import { ReverseGeocodeResult, OSMPlace } from '../types';

interface LookupPanelProps {
  currentResult: ReverseGeocodeResult | null;
  isLoading: boolean;
  onSearch: (lat: number, lon: number, order: 'narrow_to_broad' | 'broad_to_narrow') => void;
  presetCoordinates: Array<{ name: string; lat: number; lon: number; description: string }>;
  currentCoords: { lat: number; lon: number };
  onSelectPlace?: (place: OSMPlace) => void;
}

export const LookupPanel: React.FC<LookupPanelProps> = ({
  currentResult,
  isLoading,
  onSearch,
  presetCoordinates,
  currentCoords,
  onSelectPlace,
}) => {
  const [latInput, setLatInput] = useState<string>(currentCoords.lat.toString());
  const [lonInput, setLonInput] = useState<string>(currentCoords.lon.toString());
  const [order, setOrder] = useState<'narrow_to_broad' | 'broad_to_narrow'>('narrow_to_broad');
  const [filterMode, setFilterMode] = useState<'all' | 'contained_only' | 'nearby_only'>('all');
  const [copiedJSON, setCopiedJSON] = useState(false);
  const [expandedCards, setExpandedCards] = useState<{ [id: string]: boolean }>({});

  // Sync inputs if currentCoords change externally from map click
  React.useEffect(() => {
    setLatInput(currentCoords.lat.toFixed(5));
    setLonInput(currentCoords.lon.toFixed(5));
  }, [currentCoords.lat, currentCoords.lon]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(latInput);
    const lon = parseFloat(lonInput);
    if (!isNaN(lat) && !isNaN(lon)) {
      onSearch(lat, lon, order);
    }
  };

  const handlePresetSelect = (preset: { lat: number; lon: number }) => {
    setLatInput(preset.lat.toFixed(5));
    setLonInput(preset.lon.toFixed(5));
    onSearch(preset.lat, preset.lon, order);
  };

  const handleCopyJSON = () => {
    if (!currentResult) return;
    navigator.clipboard.writeText(JSON.stringify(currentResult, null, 2));
    setCopiedJSON(true);
    setTimeout(() => setCopiedJSON(false), 2000);
  };

  const toggleExpand = (id: string) => {
    setExpandedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getLevelBadge = (place: OSMPlace) => {
    if (place.placeType === 'building' || place.adminLevel === 'building') {
      return {
        bg: 'bg-amber-500/25 text-amber-300 border-amber-500/50 shadow-sm font-semibold',
        label: 'Nhà cửa • Ranh giới công trình',
        icon: Building,
      };
    }
    if (place.adminLevel === 2) {
      return {
        bg: 'bg-red-500/15 text-red-300 border-red-500/30',
        label: 'Cấp 2 • Quốc gia',
        icon: Globe2,
      };
    }
    if (place.adminLevel === 3) {
      return {
        bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
        label: 'Cấp 3 • Vùng miền',
        icon: Compass,
      };
    }
    if (place.adminLevel === 4) {
      return {
        bg: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
        label: 'Cấp 4 • Tỉnh / Thành phố',
        icon: Landmark,
      };
    }
    if (place.adminLevel === 6) {
      return {
        bg: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
        label: 'Cấp 6 • Quận / Huyện / Thị xã',
        icon: Building,
      };
    }
    if (place.adminLevel === 8) {
      return {
        bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        label: 'Cấp 8 • Phường / Xã / Thị trấn',
        icon: MapPin,
      };
    }
    return {
      bg: 'bg-amber-400/20 text-amber-300 border-amber-400/30',
      label: 'POI • Địa điểm / Tiện ích',
      icon: MapPin,
    };
  };

  return (
    <div className="w-full lg:w-[460px] xl:w-[500px] flex flex-col bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] lg:max-h-full">
      {/* Header Form */}
      <div className="p-4 border-b border-neutral-800 bg-neutral-900/90">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-amber-400" />
              <span>Toạ độ tra cứu (Lat, Lon)</span>
            </span>

            {/* Order toggle */}
            <button
              type="button"
              onClick={() => {
                const newOrder =
                  order === 'narrow_to_broad' ? 'broad_to_narrow' : 'narrow_to_broad';
                setOrder(newOrder);
                const lat = parseFloat(latInput);
                const lon = parseFloat(lonInput);
                if (!isNaN(lat) && !isNaN(lon)) {
                  onSearch(lat, lon, newOrder);
                }
              }}
              className="text-[11px] text-neutral-400 hover:text-amber-400 flex items-center gap-1 transition-colors bg-neutral-800 px-2 py-1 rounded-md border border-neutral-700"
              title="Thay đổi thứ tự phân cấp"
            >
              <ArrowUpDown className="w-3 h-3 text-amber-400" />
              <span>{order === 'narrow_to_broad' ? 'Hẹp ➔ Rộng' : 'Rộng ➔ Hẹp'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Vĩ độ (Latitude)</label>
              <input
                id="input-lat"
                type="number"
                step="any"
                required
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                placeholder="Ví dụ: 21.0287"
                className="w-full px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] text-neutral-400 mb-1">Kinh độ (Longitude)</label>
              <input
                id="input-lon"
                type="number"
                step="any"
                required
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                placeholder="Ví dụ: 105.8524"
                className="w-full px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
          </div>

          <button
            id="btn-execute-lookup"
            type="submit"
            disabled={isLoading}
            className="w-full py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-semibold text-xs rounded-lg flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-50"
          >
            <Search className="w-3.5 h-3.5" />
            <span>{isLoading ? 'Đang truy vấn OSM...' : 'Tra cứu địa điểm & Phân cấp'}</span>
          </button>
        </form>

        {/* Quick Presets Pills */}
        <div className="mt-3 pt-2.5 border-t border-neutral-800/80">
          <div className="text-[11px] text-neutral-400 mb-1.5 flex items-center justify-between">
            <span>Toạ độ mẫu tại Việt Nam:</span>
            <span className="text-[10px] text-neutral-500">Bấm để nhảy tới</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presetCoordinates.slice(0, 6).map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => handlePresetSelect(preset)}
                className="text-[11px] bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 hover:text-white px-2 py-0.5 rounded-md border border-neutral-700 transition-colors whitespace-nowrap"
              >
                {preset.name.split(' (')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400 space-y-3">
            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs">Đang truy vấn không gian & lọc Point-In-Polygon...</p>
          </div>
        ) : !currentResult ? (
          <div className="py-12 text-center text-neutral-500 text-xs">
            Nhấp chuột vào bản đồ hoặc nhập toạ độ để tra cứu các lớp địa lý.
          </div>
        ) : (
          <>
            {/* Status Bar */}
            <div className="flex items-center justify-between text-xs bg-neutral-800/40 p-2.5 rounded-xl border border-neutral-800 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  {currentResult.totalContained ?? currentResult.places.length} ranh giới bao chứa
                </span>
                {(currentResult.totalNearby ?? currentResult.nearbyPois?.length ?? 0) > 0 && (
                  <>
                    <span className="text-neutral-500">•</span>
                    <span className="text-sky-400 font-medium">
                      {currentResult.totalNearby ?? currentResult.nearbyPois?.length} tiện ích lân cận
                    </span>
                  </>
                )}
                <span className="text-neutral-500">•</span>
                <span className="text-amber-400 font-mono text-[11px] flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {currentResult.executionTimeMs} ms
                </span>
              </div>
              <button
                onClick={handleCopyJSON}
                className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-100 bg-neutral-800 hover:bg-neutral-750 px-2 py-1 rounded border border-neutral-700 transition-colors"
                title="Sao chép kết quả JSON"
              >
                {copiedJSON ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedJSON ? 'Đã chép' : 'Sao chép JSON'}</span>
              </button>
            </div>

            {/* Explanatory note */}
            <div className="text-[11px] text-neutral-400 bg-neutral-850/60 p-2.5 rounded-xl border border-neutral-800 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong className="text-neutral-300">Phân định bao chứa:</strong> Các đa giác (Quốc gia, Tỉnh/TP, Quận/Huyện, Phường/Xã, Tòa nhà) thực sự <span className="text-emerald-400 font-medium">chứa toạ độ bên trong</span> theo thuật toán Point-in-Polygon. Các điểm tiện ích (POI) không có diện tích nên được đo theo <span className="text-sky-300 font-medium">khoảng cách lân cận</span>.
              </p>
            </div>

            {/* Filter Tabs */}
            {((currentResult.nearbyPois?.length || 0) > 0 || (currentResult.totalNearby || 0) > 0) && (
              <div className="flex items-center gap-1 bg-neutral-900/80 p-1 rounded-xl border border-neutral-800 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterMode('all')}
                  className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all ${
                    filterMode === 'all'
                      ? 'bg-neutral-750 text-neutral-100 shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Tất cả ({currentResult.totalFound})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('contained_only')}
                  className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1 ${
                    filterMode === 'contained_only'
                      ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>Chỉ bao chứa ({currentResult.totalContained ?? currentResult.places.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('nearby_only')}
                  className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1 ${
                    filterMode === 'nearby_only'
                      ? 'bg-sky-950/70 text-sky-300 border border-sky-500/40 shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <MapPin className="w-3 h-3 text-sky-400" />
                  <span>Tiện ích ({currentResult.totalNearby ?? (currentResult.nearbyPois?.length || 0)})</span>
                </button>
              </div>
            )}

            {/* Prominent Building Boundary Alert when coordinate is inside a building or nearest building fallback */}
            {currentResult.hierarchy?.building && (
              <div className="bg-gradient-to-r from-amber-950/60 to-amber-900/40 border border-amber-500/40 rounded-xl p-3.5 flex items-start gap-3 shadow-lg">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0 mt-0.5">
                  <Building className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500 text-neutral-950 shadow-sm">
                      {currentResult.hierarchy.building.isContained !== false
                        ? 'Ranh giới nhà cửa / Tòa nhà'
                        : `Tòa nhà gần nhất (cách ~${currentResult.hierarchy.building.distanceMeters ?? 0}m)`}
                    </span>
                    <span className="text-[11px] text-amber-300 font-mono">
                      {currentResult.hierarchy.building.id}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-amber-100 leading-snug">
                    {currentResult.hierarchy.building.name}
                  </h4>
                  {currentResult.hierarchy.building.tags['addr:housenumber'] && (
                    <p className="text-xs text-amber-300 font-medium mt-0.5">
                      Số {currentResult.hierarchy.building.tags['addr:housenumber']}{' '}
                      {currentResult.hierarchy.building.tags['addr:street']}
                    </p>
                  )}
                  {currentResult.hierarchy.building.tags['building:levels'] && (
                    <span className="inline-block mt-1 text-[11px] text-neutral-300 mr-3">
                      Quy mô: {currentResult.hierarchy.building.tags['building:levels']} tầng
                      {currentResult.hierarchy.building.tags.height && ` • Cao ${currentResult.hierarchy.building.tags.height}`}
                    </span>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[11px] text-neutral-400">
                      {currentResult.hierarchy.building.isContained !== false
                        ? 'Toạ độ nằm trực tiếp bên trong ranh giới đa giác khép kín của công trình này.'
                        : `Toạ độ không nằm trực tiếp trong công trình nào. Tòa nhà gần nhất cách toạ độ khoảng ${currentResult.hierarchy.building.distanceMeters ?? 0}m.`}
                    </p>
                    {onSelectPlace && (
                      <button
                        type="button"
                        onClick={() => onSelectPlace(currentResult.hierarchy.building!)}
                        className="text-xs bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold px-2.5 py-1 rounded-lg shadow transition-colors shrink-0 flex items-center gap-1"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>Phóng tới tòa nhà</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Hierarchical Breadcrumb */}
            {currentResult.fullPath && currentResult.fullPath.length > 0 && (
              <div className="bg-neutral-800/60 p-3 rounded-xl border border-neutral-750">
                <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Phân cấp địa chỉ bao chứa toạ độ:</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-neutral-200">
                  {currentResult.fullPath.map((step, idx) => (
                    <React.Fragment key={idx}>
                      <span
                        className={`px-2 py-0.5 rounded ${
                          idx === currentResult.fullPath.length - 1
                            ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30'
                            : 'bg-neutral-750 text-neutral-300'
                        }`}
                      >
                        {step}
                      </span>
                      {idx < currentResult.fullPath.length - 1 && (
                        <ArrowRight className="w-3 h-3 text-neutral-500" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* Places List (Sorted by priority) */}
            <div className="space-y-2.5">
              <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                Danh sách chi tiết ({order === 'narrow_to_broad' ? 'Ưu tiên chi tiết nhất' : 'Ưu tiên cấp cao nhất'}):
              </div>

              {(() => {
                const containing = currentResult.places || [];
                const nearby = currentResult.nearbyPois || [];
                const allList = currentResult.allMatches || [...containing, ...nearby];

                const placesToShow =
                  filterMode === 'contained_only'
                    ? containing
                    : filterMode === 'nearby_only'
                    ? nearby
                    : allList;

                if (placesToShow.length === 0) {
                  return (
                    <div className="text-xs text-neutral-400 p-4 text-center bg-neutral-850/50 rounded-xl border border-neutral-800">
                      Không có địa điểm nào trong bộ lọc này.
                    </div>
                  );
                }

                return placesToShow.map((place, index) => {
                  const badge = getLevelBadge(place);
                  const BadgeIcon = badge.icon;
                  const isExpanded = !!expandedCards[place.id];
                  const isContained = place.isContained !== false && place.geometryType !== 'Point';

                  return (
                    <div
                      key={place.id}
                      id={`place-card-${place.osmId}`}
                      className={`border rounded-xl p-3 transition-all ${
                        isContained
                          ? 'bg-neutral-800/70 hover:bg-neutral-800 border-neutral-750 hover:border-neutral-700'
                          : 'bg-neutral-850/70 hover:bg-neutral-800 border-sky-950/50 hover:border-sky-800/40'
                      }`}
                    >
                      {/* Card Top: Rank & Level Badge */}
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="w-5 h-5 rounded-full bg-neutral-700 text-neutral-200 text-[10px] font-mono font-bold flex items-center justify-center">
                            #{index + 1}
                          </span>
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 ${badge.bg}`}
                          >
                            <BadgeIcon className="w-3 h-3" />
                            <span>{badge.label}</span>
                          </span>

                          {/* Containment Indicator */}
                          {isContained ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 flex items-center gap-0.5 font-medium">
                              <Check className="w-2.5 h-2.5 text-emerald-400" />
                              Bao chứa
                            </span>
                          ) : place.placeType === 'building' ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-500/30 flex items-center gap-0.5 font-medium">
                              <Building className="w-2.5 h-2.5 text-amber-400" />
                              Tòa nhà gần nhất ({place.distanceMeters ?? place.tags._distance_meters ?? 0}m)
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-500/30 flex items-center gap-0.5 font-medium">
                              <MapPin className="w-2.5 h-2.5 text-sky-400" />
                              Cách {place.distanceMeters ?? place.tags._distance_meters ?? 0}m
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {onSelectPlace && (place.bbox || place.center) && (
                            <button
                              type="button"
                              onClick={() => onSelectPlace(place)}
                              className="text-[11px] text-amber-300 hover:text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 px-2 py-0.5 rounded border border-amber-500/30 flex items-center gap-1 transition-colors"
                              title="Phóng tới ranh giới này trên bản đồ"
                            >
                              <Compass className="w-3 h-3 text-amber-400" />
                              <span>Bản đồ</span>
                            </button>
                          )}
                          {/* OSM Link */}
                          <a
                            href={`https://www.openstreetmap.org/${place.osmType}/${place.osmId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-mono text-neutral-400 hover:text-amber-400 flex items-center gap-1 transition-colors"
                            title="Xem trên openstreetmap.org"
                          >
                            <span>{place.id}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>

                      {/* Place Names */}
                      <div className="mb-2">
                        <h4 className="text-sm font-bold text-neutral-100">
                          {place.nameVi || place.name}
                        </h4>
                        {place.nameEn && place.nameEn !== place.name && (
                          <p className="text-xs text-neutral-400">{place.nameEn}</p>
                        )}
                      </div>

                      {/* Quick Specs */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-neutral-400 bg-neutral-900/60 p-2 rounded-lg font-mono">
                        <div>
                          <span className="text-neutral-500">Hình học: </span>
                          <span className="text-neutral-300">{place.geometryType}</span>
                        </div>
                        <div>
                          {place.areaApproxKm2 ? (
                            <>
                              <span className="text-neutral-500">Quy mô: </span>
                              <span className="text-neutral-300">{place.areaApproxKm2} km²</span>
                            </>
                          ) : place.distanceMeters !== undefined || place.tags._distance_meters ? (
                            <>
                              <span className="text-neutral-500">Khoảng cách: </span>
                              <span className="text-sky-300 font-semibold">
                                {place.distanceMeters ?? place.tags._distance_meters} m
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-neutral-500">Admin Level: </span>
                              <span className="text-neutral-300">{place.adminLevel}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Expand Tags Toggle */}
                      <div className="mt-2 pt-2 border-t border-neutral-750/70 flex items-center justify-between">
                        <button
                          onClick={() => toggleExpand(place.id)}
                          className="text-[11px] text-neutral-400 hover:text-neutral-200 flex items-center gap-1"
                        >
                          <Tag className="w-3 h-3 text-neutral-500" />
                          <span>{Object.keys(place.tags).length} OSM tags</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        <span className="text-[10px] text-neutral-500 font-mono">
                          {place.center ? `[${place.center[0].toFixed(3)}, ${place.center[1].toFixed(3)}]` : ''}
                        </span>
                      </div>

                      {/* Expanded OSM Tags List */}
                      {isExpanded && (
                        <div className="mt-2 p-2 bg-neutral-900 rounded-lg border border-neutral-800 text-[10px] font-mono space-y-1 overflow-x-auto">
                          {Object.entries(place.tags).map(([key, val]) => (
                            <div key={key} className="flex gap-2">
                              <span className="text-amber-400 shrink-0">{key}:</span>
                              <span className="text-neutral-300 break-all">{val}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
