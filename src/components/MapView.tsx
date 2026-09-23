import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { OSMPlace, ReverseGeocodeResult } from '../types';
import {
  Layers,
  Eye,
  EyeOff,
  Navigation,
  Maximize2,
  Crosshair,
  Building,
  Landmark,
  Globe2,
  Sun,
  Moon,
  Satellite,
  Map as MapIcon,
  Check,
} from 'lucide-react';

interface MapViewProps {
  places: OSMPlace[];
  activeCoord: { lat: number; lon: number } | null;
  onMapClick: (lat: number, lon: number) => void;
  highlightedPlaces: OSMPlace[];
  currentResult?: ReverseGeocodeResult | null;
  selectedPlace?: OSMPlace | null;
  onSelectPlace?: (place: OSMPlace) => void;
}

type BasemapType = 'voyager' | 'positron' | 'dark' | 'satellite';

const BASEMAP_CONFIGS: Record<
  BasemapType,
  {
    name: string;
    url: string;
    attribution: string;
    maxZoom: number;
    subdomains: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  voyager: {
    name: 'Bản đồ màu',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
    icon: MapIcon,
  },
  positron: {
    name: 'Bản đồ sáng',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
    icon: Sun,
  },
  dark: {
    name: 'Bản đồ tối',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
    icon: Moon,
  },
  satellite: {
    name: 'Vệ tinh',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri World Imagery',
    maxZoom: 19,
    subdomains: '',
    icon: Satellite,
  },
};

export const MapView: React.FC<MapViewProps> = ({
  places,
  activeCoord,
  onMapClick,
  highlightedPlaces,
  currentResult,
  selectedPlace,
  onSelectPlace,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const geojsonLayersRef = useRef<{ [key: string]: L.GeoJSON | L.LayerGroup }>({});
  const highlightLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // Basemap state
  const [currentBasemap, setCurrentBasemap] = useState<BasemapType>('voyager');
  const [showBasemapMenu, setShowBasemapMenu] = useState(false);

  // Layer visibility toggles
  const [visibleLayers, setVisibleLayers] = useState<{
    building: boolean;
    level2: boolean;
    level4: boolean;
    level6: boolean;
    level8: boolean;
    poi: boolean;
  }>({
    building: true, // Building Footprints (Ranh giới nhà cửa / tòa nhà)
    level2: true,   // Country (Cấp 2)
    level4: true,   // Province (Cấp 4)
    level6: true,   // District (Cấp 6)
    level8: true,   // Ward (Cấp 8)
    poi: true,      // POIs
  });

  const [showLayerWidget, setShowLayerWidget] = useState(true);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Center on Vietnam
    const map = L.map(mapContainerRef.current, {
      center: [16.0, 107.5],
      zoom: 6,
      zoomControl: false,
    });

    // Add standard zoom control in top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Initial tile layer (CartoDB Voyager: fast, open CORS, never blocked)
    const initialConfig = BASEMAP_CONFIGS[currentBasemap];
    const tileLayer = L.tileLayer(initialConfig.url, {
      maxZoom: initialConfig.maxZoom,
      attribution: initialConfig.attribution,
      subdomains: initialConfig.subdomains,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // Click handler on map
    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    });

    highlightLayerGroupRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    // Handle container resize & invalidation
    const handleResize = () => {
      map.invalidateSize();
    };

    const timer1 = setTimeout(handleResize, 150);
    const timer2 = setTimeout(handleResize, 500);

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Basemap when changed
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const config = BASEMAP_CONFIGS[currentBasemap];
    const newTileLayer = L.tileLayer(config.url, {
      maxZoom: config.maxZoom,
      attribution: config.attribution,
      subdomains: config.subdomains,
    }).addTo(map);

    newTileLayer.bringToBack();
    tileLayerRef.current = newTileLayer;
  }, [currentBasemap]);

  // Update Active Click Marker with Pulsing Pin
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (activeCoord) {
      const { lat, lon } = activeCoord;

      const customIcon = L.divIcon({
        className: 'custom-active-pin-container',
        html: `
          <div class="relative flex items-center justify-center -translate-x-1/2 -translate-y-1/2">
            <!-- Pulsing outer radar rings -->
            <span class="absolute w-10 h-10 rounded-full bg-amber-400 opacity-60 animate-ping"></span>
            <span class="absolute w-7 h-7 rounded-full bg-amber-500/40 border border-amber-300"></span>
            <!-- Center pin core -->
            <span class="relative w-5 h-5 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full border-2 border-white shadow-xl flex items-center justify-center">
              <span class="w-1.5 h-1.5 bg-neutral-950 rounded-full"></span>
            </span>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      if (!markerRef.current) {
        const marker = L.marker([lat, lon], {
          icon: customIcon,
          draggable: true,
          zIndexOffset: 1000,
        }).addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          onMapClick(pos.lat, pos.lng);
        });

        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([lat, lon]);
        markerRef.current.setIcon(customIcon);
      }
    }
  }, [activeCoord, onMapClick]);

  // Render and update GeoJSON administrative boundary & building layers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing geojson layers
    Object.values(geojsonLayersRef.current).forEach((layer) => {
      map.removeLayer(layer);
    });
    geojsonLayersRef.current = {};

    const buildingPlaces: OSMPlace[] = [];
    const level2Places: OSMPlace[] = [];
    const level4Places: OSMPlace[] = [];
    const level6Places: OSMPlace[] = [];
    const level8Places: OSMPlace[] = [];
    const poiPlaces: OSMPlace[] = [];

    for (const p of places) {
      if (p.placeType === 'building' || p.adminLevel === 'building') {
        buildingPlaces.push(p);
      } else if (p.adminLevel === 2) {
        level2Places.push(p);
      } else if (p.adminLevel === 4 || p.adminLevel === 3) {
        level4Places.push(p);
      } else if (p.adminLevel === 6) {
        level6Places.push(p);
      } else if (p.adminLevel === 8) {
        level8Places.push(p);
      } else if (p.adminLevel === 'poi' || p.placeType === 'poi') {
        poiPlaces.push(p);
      }
    }

    // Helper to add polygon layer
    const addPolygonGroup = (
      groupName: string,
      items: OSMPlace[],
      color: string,
      fillColor: string,
      weight: number,
      dashArray?: string,
      fillOpacity = 0.15
    ) => {
      const features = items
        .filter((p) => p.geometryType === 'Polygon' || p.geometryType === 'MultiPolygon')
        .map((p) => ({
          type: 'Feature' as const,
          properties: p,
          geometry: {
            type: p.geometryType,
            coordinates: (p.geometry as any).coordinates,
          },
        }));

      if (features.length === 0) return;

      const layer = L.geoJSON(
        { type: 'FeatureCollection', features } as any,
        {
          style: () => ({
            color,
            fillColor,
            fillOpacity,
            weight,
            dashArray,
          }),
          onEachFeature: (feature, l) => {
            const p = feature.properties as OSMPlace;
            const isBuilding = p.placeType === 'building' || p.adminLevel === 'building';
            const levels = p.tags['building:levels'] ? ` • ${p.tags['building:levels']} tầng` : '';
            const houseNum =
              p.tags['addr:housenumber'] && p.tags['addr:street']
                ? `<div class="text-amber-700 font-medium">Số ${p.tags['addr:housenumber']} ${p.tags['addr:street']}</div>`
                : '';

            l.bindTooltip(
              `<div class="text-xs font-sans p-1 leading-relaxed">
                <div class="font-bold text-neutral-900 flex items-center gap-1.5">
                  ${isBuilding ? '🏠 ' : '📍 '}${p.name}
                </div>
                ${houseNum}
                <div class="text-neutral-500 font-medium">${p.adminLevelLabel}${levels}</div>
                ${p.areaApproxKm2 ? `<div class="text-[10px] text-neutral-400 mt-0.5">Diện tích: ${p.areaApproxKm2.toLocaleString('vi-VN')} km²</div>` : ''}
              </div>`,
              { sticky: true, opacity: 0.98, className: 'custom-map-tooltip' }
            );

            l.on('mouseover', () => {
              (l as any).setStyle({
                weight: weight + 1.5,
                fillOpacity: Math.min(fillOpacity + 0.2, 0.7),
              });
            });

            l.on('mouseout', () => {
              (l as any).setStyle({
                weight,
                fillOpacity,
              });
            });

            l.on('click', (e) => {
              L.DomEvent.stopPropagation(e);
              onMapClick(e.latlng.lat, e.latlng.lng);
              if (onSelectPlace) {
                onSelectPlace(p);
              }
            });
          },
        }
      );

      geojsonLayersRef.current[groupName] = layer;
      layer.addTo(map);
    };

    // Add Level 2 (Country boundary)
    if (visibleLayers.level2) {
      addPolygonGroup('level2', level2Places, '#ef4444', '#f87171', 2.8, undefined, 0.08);
    }

    // Add Level 4 (Provinces / Tỉnh, TP)
    if (visibleLayers.level4) {
      addPolygonGroup('level4', level4Places, '#3b82f6', '#60a5fa', 2.0, undefined, 0.12);
    }

    // Add Level 6 (Districts / Quận, Huyện)
    if (visibleLayers.level6) {
      addPolygonGroup('level6', level6Places, '#8b5cf6', '#a78bfa', 1.6, '4, 4', 0.16);
    }

    // Add Level 8 (Wards / Phường, Xã)
    if (visibleLayers.level8) {
      addPolygonGroup('level8', level8Places, '#10b981', '#34d399', 1.4, '2, 3', 0.2);
    }

    // Add Building Footprints (Ranh giới nhà cửa / Tòa nhà)
    if (visibleLayers.building) {
      // 1. Polygon buildings
      addPolygonGroup('building', buildingPlaces, '#f59e0b', '#fbbf24', 2.2, undefined, 0.5);

      // 2. Point buildings (if any buildings are represented as points)
      const pointBuildings = buildingPlaces.filter((p) => p.geometryType === 'Point');
      if (pointBuildings.length > 0) {
        const pointGroup = L.layerGroup();
        pointBuildings.forEach((b) => {
          const [lon, lat] = (b.geometry as any).coordinates;
          const marker = L.circleMarker([lat, lon], {
            radius: 5,
            fillColor: '#f59e0b',
            color: '#ffffff',
            weight: 1.5,
            opacity: 1,
            fillOpacity: 0.9,
          });

          marker.bindTooltip(
            `<div class="text-xs font-sans">
              <div class="font-bold text-amber-900">🏠 ${b.name}</div>
              <div class="text-neutral-600">${b.adminLevelLabel}</div>
            </div>`,
            { sticky: true }
          );

          marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            onMapClick(lat, lon);
          });

          pointGroup.addLayer(marker);
        });
        geojsonLayersRef.current['buildingPoints'] = pointGroup;
        pointGroup.addTo(map);
      }
    }

    // Add POIs
    if (visibleLayers.poi) {
      const poiFeatures = poiPlaces.filter((p) => p.geometryType === 'Point');
      const poiGroup = L.layerGroup();

      poiFeatures.forEach((poi) => {
        const [lon, lat] = (poi.geometry as any).coordinates;
        const marker = L.circleMarker([lat, lon], {
          radius: 6,
          fillColor: '#38bdf8',
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85,
        });

        marker.bindTooltip(
          `<div class="text-xs font-sans">
            <div class="font-bold text-sky-900">📍 ${poi.name}</div>
            <div class="text-neutral-600">${poi.adminLevelLabel}</div>
          </div>`,
          { sticky: true }
        );

        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          onMapClick(lat, lon);
        });

        poiGroup.addLayer(marker);
      });

      geojsonLayersRef.current['poi'] = poiGroup;
      poiGroup.addTo(map);
    }
  }, [places, visibleLayers, onMapClick, onSelectPlace]);

  // Highlight containing hierarchy polygons when a coordinate is selected
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !highlightLayerGroupRef.current) return;

    highlightLayerGroupRef.current.clearLayers();

    if (!highlightedPlaces || highlightedPlaces.length === 0) return;

    // Sort to render broadest first, most specific last
    const sorted = [...highlightedPlaces].sort(
      (a, b) => (b.priorityRank || 0) - (a.priorityRank || 0)
    );

    sorted.forEach((place) => {
      if (place.geometryType === 'Polygon' || place.geometryType === 'MultiPolygon') {
        const polyGeo = {
          type: 'Feature' as const,
          properties: place,
          geometry: {
            type: place.geometryType,
            coordinates: (place.geometry as any).coordinates,
          },
        };

        const isBuilding = place.placeType === 'building' || place.adminLevel === 'building';
        const strokeColor = isBuilding
          ? '#f59e0b'
          : place.adminLevel === 8
          ? '#10b981'
          : place.adminLevel === 6
          ? '#8b5cf6'
          : place.adminLevel === 4
          ? '#3b82f6'
          : '#ef4444';

        const fillColor = strokeColor;

        const fillOpacity = isBuilding
          ? 0.65
          : place.adminLevel === 8
          ? 0.35
          : place.adminLevel === 6
          ? 0.25
          : place.adminLevel === 4
          ? 0.15
          : 0.08;

        const weight = isBuilding ? 3.5 : 2.5;

        const highlightLayer = L.geoJSON(polyGeo, {
          style: {
            color: strokeColor,
            fillColor,
            fillOpacity,
            weight,
            dashArray: isBuilding ? undefined : '4, 4',
          },
        });

        highlightLayerGroupRef.current?.addLayer(highlightLayer);
      }
    });
  }, [highlightedPlaces]);

  // Handle focusing on selected place
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedPlace) return;

    if (selectedPlace.bbox) {
      const { minLat, minLon, maxLat, maxLon } = selectedPlace.bbox;
      map.fitBounds(
        [
          [minLat, minLon],
          [maxLat, maxLon],
        ],
        { padding: [50, 50], maxZoom: 18 }
      );
    } else if (selectedPlace.center) {
      map.flyTo([selectedPlace.center[1], selectedPlace.center[0]], 16);
    }
  }, [selectedPlace]);

  // Action: Zoom directly to active coordinate
  const focusActiveCoord = useCallback(() => {
    if (!mapInstanceRef.current || !activeCoord) return;
    // If a building is highlighted, zoom in close to view the building outline
    const hasBuilding = highlightedPlaces.some(
      (p) => p.placeType === 'building' || p.adminLevel === 'building'
    );
    const targetZoom = hasBuilding ? 18 : 15;
    mapInstanceRef.current.flyTo([activeCoord.lat, activeCoord.lon], targetZoom, {
      duration: 1.2,
    });
  }, [activeCoord, highlightedPlaces]);

  // Action: Fit bounds of enclosing district or ward
  const fitEnclosingBounds = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Prefer fitting ward or district if available
    const target =
      highlightedPlaces.find((p) => p.adminLevel === 8) ||
      highlightedPlaces.find((p) => p.adminLevel === 6) ||
      highlightedPlaces.find(
        (p) => p.placeType === 'building' || p.adminLevel === 'building'
      ) ||
      highlightedPlaces.find((p) => p.adminLevel === 4);

    if (target?.bbox) {
      map.fitBounds(
        [
          [target.bbox.minLat, target.bbox.minLon],
          [target.bbox.maxLat, target.bbox.maxLon],
        ],
        { padding: [40, 40], maxZoom: 17 }
      );
    } else if (activeCoord) {
      map.flyTo([activeCoord.lat, activeCoord.lon], 15);
    }
  }, [highlightedPlaces, activeCoord]);

  // Action: Reset to whole Vietnam view
  const resetViewVietnam = () => {
    mapInstanceRef.current?.setView([16.0, 107.5], 6);
  };

  return (
    <div className="relative w-full h-full min-h-[520px] flex-1 bg-neutral-950 overflow-hidden rounded-2xl border border-neutral-800 shadow-xl flex flex-col">
      {/* Top Floating Control Bar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none gap-2">
        {/* Left Quick Navigation Actions */}
        <div className="flex items-center gap-1.5 pointer-events-auto flex-wrap">
          <button
            id="btn-reset-map-view"
            onClick={resetViewVietnam}
            title="Xem toàn bộ Việt Nam"
            className="flex items-center gap-1.5 bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 hover:text-white px-2.5 py-1.5 rounded-xl border border-neutral-700/80 backdrop-blur shadow-md text-xs font-medium transition-all"
          >
            <Maximize2 className="w-3.5 h-3.5 text-red-400" />
            <span className="hidden sm:inline">Toàn cảnh Việt Nam</span>
          </button>

          {activeCoord && (
            <>
              <button
                id="btn-focus-coord"
                onClick={focusActiveCoord}
                title="Phóng tới điểm toạ độ tra cứu"
                className="flex items-center gap-1.5 bg-neutral-900/90 hover:bg-neutral-800 text-amber-300 hover:text-amber-200 px-2.5 py-1.5 rounded-xl border border-amber-500/40 backdrop-blur shadow-md text-xs font-medium transition-all"
              >
                <Crosshair className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span>Phóng tới điểm này</span>
              </button>

              <button
                id="btn-fit-bounds"
                onClick={fitEnclosingBounds}
                title="Xem trọn vẹn ranh giới hành chính bao quanh"
                className="flex items-center gap-1.5 bg-neutral-900/90 hover:bg-neutral-800 text-emerald-300 hover:text-emerald-200 px-2.5 py-1.5 rounded-xl border border-emerald-500/40 backdrop-blur shadow-md text-xs font-medium transition-all"
              >
                <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden md:inline">Xem ranh giới bao quanh</span>
              </button>
            </>
          )}
        </div>

        {/* Right: Basemap Selector */}
        <div className="relative pointer-events-auto">
          <button
            onClick={() => setShowBasemapMenu(!showBasemapMenu)}
            className="flex items-center gap-1.5 bg-neutral-900/90 hover:bg-neutral-800 text-neutral-200 hover:text-white px-2.5 py-1.5 rounded-xl border border-neutral-700/80 backdrop-blur shadow-md text-xs font-medium transition-all"
          >
            {React.createElement(BASEMAP_CONFIGS[currentBasemap].icon, {
              className: 'w-3.5 h-3.5 text-amber-400',
            })}
            <span className="hidden sm:inline">{BASEMAP_CONFIGS[currentBasemap].name}</span>
          </button>

          {showBasemapMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-44 bg-neutral-900/95 backdrop-blur-md rounded-xl border border-neutral-700 shadow-xl p-1 z-30 space-y-0.5">
              {(Object.keys(BASEMAP_CONFIGS) as BasemapType[]).map((key) => {
                const config = BASEMAP_CONFIGS[key];
                const IconComponent = config.icon;
                const isSelected = currentBasemap === key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setCurrentBasemap(key);
                      setShowBasemapMenu(false);
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                      isSelected
                        ? 'bg-amber-500/20 text-amber-300 font-semibold'
                        : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <IconComponent className="w-3.5 h-3.5" />
                      <span>{config.name}</span>
                    </div>
                    {isSelected && <Check className="w-3 h-3 text-amber-400" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Floating Active Hierarchy Breadcrumb Ribbon */}
      {currentResult && currentResult.fullPath && currentResult.fullPath.length > 0 && (
        <div className="absolute top-14 left-3 right-3 z-10 pointer-events-none">
          <div className="max-w-2xl bg-neutral-950/85 backdrop-blur-md border border-amber-500/30 rounded-xl px-3 py-2 shadow-xl pointer-events-auto flex items-center gap-2 overflow-x-auto text-xs">
            <span className="text-amber-400 font-bold shrink-0 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
              Ranh giới:
            </span>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              {currentResult.places.map((p, idx) => {
                const isBuilding =
                  p.placeType === 'building' || p.adminLevel === 'building';
                const tagColor = isBuilding
                  ? 'bg-amber-500/25 text-amber-300 border-amber-500/50'
                  : p.adminLevel === 8
                  ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40'
                  : p.adminLevel === 6
                  ? 'bg-purple-500/25 text-purple-300 border-purple-500/40'
                  : p.adminLevel === 4
                  ? 'bg-blue-500/25 text-blue-300 border-blue-500/40'
                  : 'bg-red-500/25 text-red-300 border-red-500/40';

                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (onSelectPlace) onSelectPlace(p);
                    }}
                    title={`Bấm để phóng tới ranh giới: ${p.name}`}
                    className={`px-2 py-0.5 rounded-md border text-[11px] font-medium transition-all hover:scale-105 ${tagColor}`}
                  >
                    {isBuilding ? '🏠 ' : ''}
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Leaflet Map Div */}
      <div
        id="map-container"
        ref={mapContainerRef}
        className="w-full h-full min-h-[500px] flex-1 z-0 outline-none"
        style={{ minHeight: '500px' }}
      />

      {/* Floating Layer Controls Widget */}
      <div className="absolute bottom-5 right-4 z-10">
        <div className="bg-neutral-900/95 backdrop-blur-md rounded-2xl border border-neutral-750 shadow-2xl p-3.5 w-68 transition-all">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-neutral-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              <span>Lớp dữ liệu bản đồ OSM</span>
            </div>
            <button
              onClick={() => setShowLayerWidget(!showLayerWidget)}
              className="text-neutral-400 hover:text-neutral-200 text-xs p-1"
            >
              {showLayerWidget ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>

          {showLayerWidget && (
            <div className="space-y-2 text-xs">
              {/* Building Footprints - Prioritized on top */}
              <label className="flex items-center justify-between cursor-pointer hover:bg-neutral-800/60 p-1.5 rounded-lg transition-colors bg-amber-500/10 border border-amber-500/30">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-sm border-2 border-amber-500 bg-amber-500/80 shadow-sm flex items-center justify-center text-[9px] text-neutral-950 font-bold">
                    🏠
                  </span>
                  <div className="flex flex-col">
                    <span className="text-amber-200 font-semibold leading-tight">
                      Ranh giới nhà cửa
                    </span>
                    <span className="text-[10px] text-amber-300/80">
                      Tòa nhà & công trình
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={visibleLayers.building}
                  onChange={(e) =>
                    setVisibleLayers({ ...visibleLayers, building: e.target.checked })
                  }
                  className="rounded border-amber-500 bg-neutral-800 text-amber-500 focus:ring-amber-400"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-neutral-800/50 p-1 rounded transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-red-500 bg-red-500/30"></span>
                  <span className="text-neutral-200">Cấp 2: Quốc gia (Việt Nam)</span>
                </div>
                <input
                  type="checkbox"
                  checked={visibleLayers.level2}
                  onChange={(e) =>
                    setVisibleLayers({ ...visibleLayers, level2: e.target.checked })
                  }
                  className="rounded border-neutral-600 bg-neutral-800 text-amber-500 focus:ring-amber-400"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-neutral-800/50 p-1 rounded transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-blue-500 bg-blue-500/30"></span>
                  <span className="text-neutral-200">Cấp 4: Tỉnh / Thành phố</span>
                </div>
                <input
                  type="checkbox"
                  checked={visibleLayers.level4}
                  onChange={(e) =>
                    setVisibleLayers({ ...visibleLayers, level4: e.target.checked })
                  }
                  className="rounded border-neutral-600 bg-neutral-800 text-amber-500 focus:ring-amber-400"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-neutral-800/50 p-1 rounded transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-purple-500 bg-purple-500/30"></span>
                  <span className="text-neutral-200">Cấp 6: Quận / Huyện / Thị xã</span>
                </div>
                <input
                  type="checkbox"
                  checked={visibleLayers.level6}
                  onChange={(e) =>
                    setVisibleLayers({ ...visibleLayers, level6: e.target.checked })
                  }
                  className="rounded border-neutral-600 bg-neutral-800 text-amber-500 focus:ring-amber-400"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-neutral-800/50 p-1 rounded transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-emerald-500 bg-emerald-500/30"></span>
                  <span className="text-neutral-200">Cấp 8: Phường / Xã / Thị trấn</span>
                </div>
                <input
                  type="checkbox"
                  checked={visibleLayers.level8}
                  onChange={(e) =>
                    setVisibleLayers({ ...visibleLayers, level8: e.target.checked })
                  }
                  className="rounded border-neutral-600 bg-neutral-800 text-amber-500 focus:ring-amber-400"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:bg-neutral-800/50 p-1 rounded transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full border-2 border-sky-400 bg-sky-400"></span>
                  <span className="text-neutral-200">Điểm quan tâm / POIs</span>
                </div>
                <input
                  type="checkbox"
                  checked={visibleLayers.poi}
                  onChange={(e) =>
                    setVisibleLayers({ ...visibleLayers, poi: e.target.checked })
                  }
                  className="rounded border-neutral-600 bg-neutral-800 text-amber-500 focus:ring-amber-400"
                />
              </label>

              <div className="pt-2 border-t border-neutral-800 text-[11px] text-neutral-400 flex items-center gap-1.5">
                <Navigation className="w-3 h-3 text-amber-400 shrink-0" />
                <span>Nhấp bất kỳ điểm nào trên bản đồ để tra cứu toạ độ</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
