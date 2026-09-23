import React from 'react';
import { MapPin, Layers, Code, UploadCloud, RefreshCw, Database, ExternalLink } from 'lucide-react';
import { DatasetStatus } from '../types';

interface NavbarProps {
  activeTab: 'map' | 'api' | 'upload';
  setActiveTab: (tab: 'map' | 'api' | 'upload') => void;
  status: DatasetStatus | null;
  onResetDefault: () => void;
  isResetting: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  status,
  onResetDefault,
  isResetting,
}) => {
  return (
    <header className="bg-neutral-900/90 backdrop-blur border-b border-neutral-800 sticky top-0 z-30 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-sm">
            <MapPin className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base md:text-lg text-neutral-100 tracking-tight">
                OSM Vietnam Reverse Geocoder
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                PBF Engine
              </span>
            </div>
            <p className="text-xs text-neutral-400 hidden sm:block">
              Tra cứu phân cấp hành chính toạ độ & Bản đồ ranh giới OSM Việt Nam
            </p>
          </div>
        </div>

        {/* Dataset Status Pill */}
        <div className="hidden lg:flex items-center gap-2 bg-neutral-800/80 px-3 py-1.5 rounded-lg border border-neutral-750 text-xs">
          <Database className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-neutral-400">Nguồn:</span>
          <span className="text-neutral-200 font-medium max-w-[180px] truncate" title={status?.sourceName}>
            {status?.sourceType === 'postgres'
              ? 'PostgreSQL (Cloud SQL)'
              : status?.sourceType === 'uploaded_pbf'
              ? `File: ${status.sourceName}`
              : 'Dữ liệu chuẩn Việt Nam'}
          </span>
          <span className="bg-neutral-700/80 text-emerald-300 font-mono text-[11px] px-1.5 py-0.5 rounded">
            {status?.stats.totalEntities || 0} đối tượng
          </span>
          {status?.database?.connected && (
            <span className="bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 font-mono text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1" title="Dữ liệu được lưu bền vững vào PostgreSQL">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Postgres
            </span>
          )}
          {status?.stats?.buildings ? (
            <span className="bg-amber-950/60 border border-amber-500/30 text-amber-300 font-mono text-[11px] px-1.5 py-0.5 rounded flex items-center gap-1">
              <span>🏠</span> {status.stats.buildings} nhà/công trình
            </span>
          ) : null}
        </div>

        {/* Navigation Tabs & Actions */}
        <div className="flex items-center gap-2">
          <nav className="flex items-center bg-neutral-800/90 p-1 rounded-xl border border-neutral-700">
            <button
              id="tab-map-btn"
              onClick={() => setActiveTab('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'map'
                  ? 'bg-amber-500 text-neutral-950 font-semibold shadow-sm'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-750'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Bản đồ & Tra cứu</span>
            </button>

            <button
              id="tab-api-btn"
              onClick={() => setActiveTab('api')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'api'
                  ? 'bg-amber-500 text-neutral-950 font-semibold shadow-sm'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-750'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>API Endpoint</span>
            </button>

            <button
              id="tab-upload-btn"
              onClick={() => setActiveTab('upload')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all relative ${
                activeTab === 'upload'
                  ? 'bg-amber-500 text-neutral-950 font-semibold shadow-sm'
                  : 'text-neutral-300 hover:text-white hover:bg-neutral-750'
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Tải file & Lỗi PBF</span>
              {status?.lastParseStats && status.lastParseStats.errorCount > 0 ? (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              ) : status?.lastParseStats && status.lastParseStats.warningCount > 0 ? (
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              ) : null}
            </button>
          </nav>

          {status?.sourceType === 'uploaded_pbf' && (
            <button
              id="btn-reset-default"
              onClick={onResetDefault}
              disabled={isResetting}
              title="Khôi phục lại dữ liệu mặc định ban đầu"
              className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-amber-400 border border-neutral-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isResetting ? 'animate-spin' : ''}`} />
            </button>
          )}

          <button
            id="btn-open-standalone-tab"
            onClick={() => window.open(window.location.href, '_blank')}
            title="Mở ứng dụng độc lập trong Tab mới (vượt qua hạn chế Cookie bên thứ 3 của iFrame)"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-amber-400 text-xs border border-neutral-700 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Mở tab mới</span>
          </button>
        </div>
      </div>
    </header>
  );
};
