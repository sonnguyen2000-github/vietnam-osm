import React, { useState, useRef, useEffect } from 'react';
import {
  UploadCloud,
  FileCheck,
  AlertCircle,
  Database,
  RefreshCw,
  ExternalLink,
  Info,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Copy,
  Check,
  Search,
  Filter,
  Bug,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Sparkles,
  Globe,
  Link as LinkIcon,
  Download,
} from 'lucide-react';
import { DatasetStatus, PBFParseStats, PBFProcessingLog } from '../types';

interface UploadViewProps {
  status: DatasetStatus | null;
  onUploadSuccess: (newStatus: DatasetStatus) => void;
  onResetDefault: () => void;
  isResetting: boolean;
}

export const UploadView: React.FC<UploadViewProps> = ({
  status,
  onUploadSuccess,
  onResetDefault,
  isResetting,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    message: string;
    stats: PBFParseStats;
    totalIndexed: number;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [customUrl, setCustomUrl] = useState('');
  const [isUrlImporting, setIsUrlImporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadChunkStatus, setUploadChunkStatus] = useState<string>('');
  const [isCookieBlocked, setIsCookieBlocked] = useState<boolean>(false);

  // Error & Diagnostic Monitor State
  const [activeStats, setActiveStats] = useState<PBFParseStats | null>(
    status?.lastParseStats || null
  );
  const [filterLevel, setFilterLevel] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync with status changes
  useEffect(() => {
    if (status?.lastParseStats) {
      setActiveStats(status.lastParseStats);
    }
  }, [status]);

  const handleFileChange = (file: File) => {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.osm') && !name.endsWith('.pbf') && !name.endsWith('.osm.pbf')) {
      setErrorMessage('Vui lòng chọn file có phần mở rộng .osm, .pbf hoặc .osm.pbf');
      setSelectedFile(null);
      return;
    }
    setErrorMessage(null);
    setSuccessInfo(null);
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunk size to ensure requests stay well within Cloud Run proxy limits

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setErrorMessage(null);
    setSuccessInfo(null);
    setIsCookieBlocked(false);
    setUploadProgress(0);
    setUploadChunkStatus('Chuẩn bị tệp tải lên...');

    const fileSizeMB = (selectedFile.size / (1024 * 1024)).toFixed(2);
    const fileName = selectedFile.name;
    const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const totalChunks = Math.max(1, Math.ceil(selectedFile.size / CHUNK_SIZE));

    try {
      let finalJsonResult: any = null;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(selectedFile.size, start + CHUNK_SIZE);
        const chunkBlob = selectedFile.slice(start, end);

        const progressPercent = Math.round((chunkIndex / totalChunks) * 100);
        setUploadProgress(progressPercent);
        setUploadChunkStatus(
          `Đang tải lên mảnh ${chunkIndex + 1}/${totalChunks} (${progressPercent}%)...`
        );

        const chunkFormData = new FormData();
        chunkFormData.append('chunk', chunkBlob, `${fileName}.part${chunkIndex}`);
        chunkFormData.append('fileId', fileId);
        chunkFormData.append('fileName', fileName);
        chunkFormData.append('chunkIndex', chunkIndex.toString());
        chunkFormData.append('totalChunks', totalChunks.toString());

        let attempt = 0;
        let chunkSuccess = false;
        let lastError: any = null;

        while (attempt < 2 && !chunkSuccess) {
          attempt++;
          try {
            const response = await fetch('/api/upload-chunk', {
              method: 'POST',
              body: chunkFormData,
              credentials: 'include',
            });

            const responseText = await response.text();
            let json: any = null;

            try {
              json = JSON.parse(responseText);
            } catch {
              // Check if response contains AI Studio / Cloud Run cookie check or auth interstitial
              const isCookieAuth =
                responseText.includes('AUTH_FLOW_TEST_COOKIE_NAME') ||
                responseText.includes('blocking a required security cookie') ||
                responseText.includes('Action required to load your app') ||
                responseText.includes('Authenticate in new window');

              if (isCookieAuth) {
                setIsCookieBlocked(true);
                const friendlyMsg =
                  'Trình duyệt đang chặn Cookie bảo mật bên thứ 3 trong khung xem trước (iFrame) của Google AI Studio.';
                const details =
                  'Nguyên nhân: Bản xem trước của AI Studio chạy trong một iFrame nhúng cross-site. Trình duyệt (Chrome / Safari) tự động kích hoạt chính sách chặn cookie bên thứ 3 đối với tên miền Cloud Run. ' +
                  'Khắc phục: Hãy nhấn nút "Mở ứng dụng ở Tab Mới" để mở ứng dụng trong tab độc lập, mọi rào cản iFrame sẽ được giải phóng và tải file lên ngay tức thì.';

                const logEntry: PBFProcessingLog = {
                  id: `err-cookie-${Date.now()}`,
                  level: 'error',
                  timestamp: new Date().toLocaleTimeString('vi-VN'),
                  category: 'file_validation',
                  message: friendlyMsg,
                  details,
                  itemId: `file/${fileName}`,
                };

                setActiveStats({
                  totalEntitiesRead: 0,
                  nodesCount: 0,
                  waysCount: 0,
                  relationsCount: 0,
                  adminBoundariesBuilt: 0,
                  buildingsBuilt: 0,
                  poisBuilt: 0,
                  skippedWaysCount: 0,
                  unresolvedNodesCount: 0,
                  errorCount: 1,
                  warningCount: 0,
                  durationMs: 0,
                  logs: [logEntry],
                });

                throw new Error(friendlyMsg);
              }

              // Sanitize any raw HTML or CSS from proxy errors
              let cleanText = responseText
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

              const friendlyMsg =
                cleanText && cleanText.length > 0
                  ? cleanText.slice(0, 250)
                  : `Lỗi kết nối máy chủ HTTP ${response.status}: ${response.statusText}`;
              throw new Error(friendlyMsg);
            }

            if (!response.ok || !json.success) {
              throw new Error(json.error || `Mảnh ${chunkIndex + 1}/${totalChunks} tải lên thất bại`);
            }

            if (json.completed) {
              finalJsonResult = json;
            }
            chunkSuccess = true;
          } catch (e: any) {
            lastError = e;
            if (e.message && e.message.includes('Cookie bảo mật')) {
              throw e; // Do not retry if cookie auth blocked
            }
            if (attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 800));
            }
          }
        }

        if (!chunkSuccess) {
          throw lastError || new Error(`Lỗi kết nối khi tải mảnh ${chunkIndex + 1}/${totalChunks}`);
        }
      }

      setUploadProgress(100);
      setUploadChunkStatus('Đang hoàn tất giải mã PBF và cập nhật bản đồ...');

      if (finalJsonResult) {
        if (finalJsonResult.stats) {
          setActiveStats(finalJsonResult.stats);
        }

        setSuccessInfo({
          message: finalJsonResult.message,
          stats: finalJsonResult.stats,
          totalIndexed: finalJsonResult.totalIndexed,
        });

        if (finalJsonResult.dataset) {
          onUploadSuccess(finalJsonResult.dataset);
        }
        setSelectedFile(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi tải hoặc phân tích file PBF');
      setActiveStats((prev) => {
        if (prev && prev.logs && prev.logs.length > 0) return prev;
        return {
          totalEntitiesRead: 0,
          nodesCount: 0,
          waysCount: 0,
          relationsCount: 0,
          adminBoundariesBuilt: 0,
          buildingsBuilt: 0,
          poisBuilt: 0,
          skippedWaysCount: 0,
          unresolvedNodesCount: 0,
          errorCount: 1,
          warningCount: 0,
          durationMs: 0,
          logs: [
            {
              id: `err-network-${Date.now()}`,
              level: 'error',
              timestamp: new Date().toLocaleTimeString('vi-VN'),
              category: 'file_validation',
              message: err.message || 'Lỗi kết nối khi gửi dữ liệu file PBF',
              details: `File: ${fileName} (${fileSizeMB} MB). Chi tiết: ${err.message || err.toString()}`,
              itemId: `file/${fileName}`,
            },
          ],
        };
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleUrlImport = async (urlToUse?: string, nameToUse?: string) => {
    const targetUrl = (urlToUse || customUrl).trim();
    if (!targetUrl) {
      setErrorMessage('Vui lòng nhập đường dẫn URL của file OSM PBF');
      return;
    }

    setIsUrlImporting(true);
    setErrorMessage(null);
    setSuccessInfo(null);

    try {
      const response = await fetch('/api/import-pbf-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, name: nameToUse }),
        credentials: 'include',
      });

      const responseText = await response.text();
      let json: any = null;
      try {
        json = JSON.parse(responseText);
      } catch {
        const cleanText = responseText
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        throw new Error(cleanText || `Lỗi phản hồi máy chủ HTTP ${response.status}`);
      }

      if (json.stats) {
        setActiveStats(json.stats);
      }

      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Tải file PBF từ URL thất bại');
      }

      setSuccessInfo({
        message: json.message,
        stats: json.stats,
        totalIndexed: json.totalIndexed,
      });

      if (json.dataset) {
        onUploadSuccess(json.dataset);
      }
      setCustomUrl('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi tải dữ liệu từ URL');
      setActiveStats((prev) => {
        if (prev && prev.logs && prev.logs.length > 0) return prev;
        return {
          totalEntitiesRead: 0,
          nodesCount: 0,
          waysCount: 0,
          relationsCount: 0,
          adminBoundariesBuilt: 0,
          buildingsBuilt: 0,
          poisBuilt: 0,
          skippedWaysCount: 0,
          unresolvedNodesCount: 0,
          errorCount: 1,
          warningCount: 0,
          durationMs: 0,
          logs: [
            {
              id: `err-url-${Date.now()}`,
              level: 'error',
              timestamp: new Date().toLocaleTimeString('vi-VN'),
              category: 'protobuf_stream',
              message: err.message || 'Lỗi tải/phân tích URL file PBF',
              details: `URL mục tiêu: ${targetUrl}. Chi tiết kỹ thuật: ${err.stack || err.toString()}`,
              itemId: 'url_import',
            },
          ],
        };
      });
    } finally {
      setIsUrlImporting(false);
    }
  };

  // Simulate diagnostic logs for demonstration and testing
  const handleSimulateDiagnostics = async () => {
    setIsSimulating(true);
    try {
      const res = await fetch('/api/simulate-pbf-error', { method: 'POST' });
      const json = await res.json();
      if (json.success && json.stats) {
        setActiveStats(json.stats);
      }
    } catch (e: any) {
      console.error('Failed to simulate diagnostic logs:', e);
    } finally {
      setIsSimulating(false);
    }
  };

  // Copy logs as formatted text or JSON
  const handleCopyLogs = () => {
    if (!activeStats?.logs) return;
    const report = {
      summary: {
        totalEntitiesRead: activeStats.totalEntitiesRead,
        nodes: activeStats.nodesCount,
        ways: activeStats.waysCount,
        relations: activeStats.relationsCount,
        adminBoundariesBuilt: activeStats.adminBoundariesBuilt,
        skippedWays: activeStats.skippedWaysCount,
        unresolvedNodes: activeStats.unresolvedNodesCount,
        errors: activeStats.errorCount,
        warnings: activeStats.warningCount,
        durationMs: activeStats.durationMs,
      },
      logs: activeStats.logs,
    };

    navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  // Filter logs
  const logsList = activeStats?.logs || [];
  const filteredLogs = logsList.filter((log) => {
    if (filterLevel !== 'all' && log.level !== filterLevel) return false;
    if (filterCategory !== 'all' && log.category !== filterCategory) return false;
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase();
      const matchMsg = log.message.toLowerCase().includes(q);
      const matchDet = log.details ? log.details.toLowerCase().includes(q) : false;
      const matchId = log.itemId ? log.itemId.toLowerCase().includes(q) : false;
      if (!matchMsg && !matchDet && !matchId) return false;
    }
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 1. Current Active Dataset Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-neutral-100">
                Nguồn dữ liệu OSM đang hoạt động
              </h3>
              <p className="text-xs text-neutral-400">
                {status?.sourceType === 'uploaded_pbf'
                  ? `File tải lên: ${status?.sourceName}`
                  : 'Dữ liệu hành chính Việt Nam mặc định (Tỉnh, Quận/Huyện, Phường/Xã)'}
              </p>
            </div>
          </div>

          <button
            id="btn-uploadview-reset"
            onClick={onResetDefault}
            disabled={isResetting || status?.sourceType === 'default_vietnam'}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-750 text-neutral-300 hover:text-amber-400 border border-neutral-700 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
            <span>Khôi phục dữ liệu gốc</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mt-4">
          <div className="bg-neutral-800/60 p-3 rounded-xl border border-neutral-750">
            <div className="text-[11px] text-neutral-400">Tổng đối tượng</div>
            <div className="text-xl font-bold text-neutral-100 font-mono mt-1">
              {status?.stats.totalEntities || 0}
            </div>
          </div>
          <div className="bg-amber-500/10 p-3 rounded-xl border border-amber-500/30">
            <div className="text-[11px] text-amber-300 font-semibold flex items-center gap-1">
              <span>🏠</span> Nhà / Tòa nhà
            </div>
            <div className="text-xl font-bold text-amber-400 font-mono mt-1">
              {status?.stats.buildings || 0}
            </div>
          </div>
          <div className="bg-neutral-800/60 p-3 rounded-xl border border-neutral-750">
            <div className="text-[11px] text-neutral-400">Quốc gia (Cấp 2)</div>
            <div className="text-xl font-bold text-red-400 font-mono mt-1">
              {status?.stats.countries || 0}
            </div>
          </div>
          <div className="bg-neutral-800/60 p-3 rounded-xl border border-neutral-750">
            <div className="text-[11px] text-neutral-400">Tỉnh/TP (Cấp 4)</div>
            <div className="text-xl font-bold text-blue-400 font-mono mt-1">
              {status?.stats.provinces || 0}
            </div>
          </div>
          <div className="bg-neutral-800/60 p-3 rounded-xl border border-neutral-750">
            <div className="text-[11px] text-neutral-400">Quận/Huyện (Cấp 6)</div>
            <div className="text-xl font-bold text-purple-400 font-mono mt-1">
              {status?.stats.districts || 0}
            </div>
          </div>
          <div className="bg-neutral-800/60 p-3 rounded-xl border border-neutral-750">
            <div className="text-[11px] text-neutral-400">Phường/Xã (Cấp 8)</div>
            <div className="text-xl font-bold text-emerald-400 font-mono mt-1">
              {status?.stats.wards || 0}
            </div>
          </div>
          <div className="bg-neutral-800/60 p-3 rounded-xl border border-neutral-750">
            <div className="text-[11px] text-neutral-400">Điểm POIs</div>
            <div className="text-xl font-bold text-amber-300 font-mono mt-1">
              {status?.stats.pois || 0}
            </div>
          </div>
        </div>

        {/* PostgreSQL Database Persistence Banner */}
        <div className="mt-4 pt-4 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-3 text-xs bg-neutral-950/60 p-3.5 rounded-xl border border-neutral-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-neutral-200">
                  Cơ sở dữ liệu PostgreSQL (Cloud SQL - asia-southeast1)
                </span>
                <span className="bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Đang hoạt động & Lưu vĩnh viễn
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Dữ liệu import từ file được lưu tự động vào PostgreSQL. Khi khởi động lại ứng dụng, toàn bộ dữ liệu được tải lại ngay lập tức mà không cần import lại.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-reload-postgres"
              type="button"
              onClick={async () => {
                try {
                  const res = await fetch('/api/database/reload', { method: 'POST' });
                  const json = await res.json();
                  if (json.success && json.dataset) {
                    onUploadSuccess(json.dataset);
                    if (json.dataset.lastParseStats) {
                      setSuccessInfo({
                        message: json.message || `Đã nạp lại ${json.dataset.stats.totalEntities} địa điểm từ PostgreSQL!`,
                        stats: json.dataset.lastParseStats,
                        totalIndexed: json.dataset.stats.totalEntities,
                      });
                    }
                  }
                } catch (e: any) {
                  setErrorMessage(e.message || 'Lỗi khi nạp dữ liệu từ PostgreSQL');
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-750 text-neutral-300 hover:text-emerald-400 border border-neutral-700 text-xs font-medium transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Đồng bộ từ Database</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Upload PBF Card */}
      {/* 2. Upload PBF Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-neutral-100">
              Cập nhật File Dữ liệu OpenStreetMap (.osm / .pbf)
            </h3>
            <p className="text-xs text-neutral-400 mt-0.5">
              Hỗ trợ nạp file XML <code className="bg-neutral-800 px-1 py-0.5 rounded text-amber-300 font-mono">.osm</code> hoặc nhị phân <code className="bg-neutral-800 px-1 py-0.5 rounded text-amber-300 font-mono">.pbf</code> từ máy tính hoặc qua URL.
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800 text-xs font-medium">
            <button
              onClick={() => {
                setUploadMode('file');
                setErrorMessage(null);
              }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                uploadMode === 'file'
                  ? 'bg-amber-500/20 text-amber-300 font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Tải file máy tính</span>
            </button>
            <button
              onClick={() => {
                setUploadMode('url');
                setErrorMessage(null);
              }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
                uploadMode === 'url'
                  ? 'bg-amber-500/20 text-amber-300 font-semibold shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Nạp trực tiếp qua Server (URL)</span>
            </button>
          </div>
        </div>

        {uploadMode === 'file' ? (
          <>
            {/* Drag & Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                isDragOver
                  ? 'border-amber-400 bg-amber-500/10'
                  : 'border-neutral-700 hover:border-neutral-600 bg-neutral-850/50 hover:bg-neutral-800/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".osm,.pbf,.osm.pbf"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileChange(e.target.files[0]);
                  }
                }}
              />

              <div className="flex flex-col items-center justify-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-neutral-800 border border-neutral-700 flex items-center justify-center text-amber-400 shadow-inner">
                  <UploadCloud className="w-7 h-7" />
                </div>

                {selectedFile ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 text-sm font-semibold text-emerald-400">
                      <FileCheck className="w-4 h-4" />
                      <span>{selectedFile.name}</span>
                    </div>
                    <p className="text-xs text-neutral-400">
                      Dung lượng: {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>

                    {selectedFile.size > 35 * 1024 * 1024 && (
                      <div className="max-w-md mx-auto mt-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-left text-xs text-amber-300 space-y-1.5">
                        <div className="flex items-center gap-1.5 font-semibold text-amber-200">
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                          <span>Lưu ý file lớn ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)</span>
                        </div>
                        <p className="text-[11px] text-amber-300/90 leading-relaxed">
                          Môi trường Cloud Run giới hạn gói tin HTTP tải lên trực tiếp tối đa ~32MB. File OSM gốc chứa nhiều đường sá và nhà cửa nên rất nặng. Nếu gặp lỗi 413, vui lòng chạy lệnh lọc ranh giới hành chính bằng <strong>osmium</strong> bên dưới để giảm file xuống còn <strong>~15MB</strong>.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-neutral-200">
                      Kéo thả file <span className="text-amber-400 font-mono">.osm</span> hoặc{' '}
                      <span className="text-amber-400 font-mono">.pbf</span> vào đây, hoặc{' '}
                      <span className="text-amber-400 underline">bấm để chọn</span>
                    </p>
                    <p className="text-xs text-neutral-500">
                      Hỗ trợ cả file chuẩn OpenStreetMap XML (.osm) và nhị phân Protocolbuffer (.pbf / .osm.pbf).
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Action & Progress Area */}
            {selectedFile && (
              <div className="mt-4 space-y-3">
                {isUploading && (
                  <div className="w-full space-y-2 p-3 bg-neutral-900/90 rounded-xl border border-neutral-750">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-amber-300 font-medium flex items-center gap-2">
                        <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
                        <span>{uploadChunkStatus || 'Đang truyền luồng dữ liệu...'}</span>
                      </span>
                      <span className="font-mono font-bold text-amber-400">{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-300 rounded-full"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-3">
                  <button
                    onClick={() => setSelectedFile(null)}
                    disabled={isUploading}
                    className="px-4 py-2 text-xs text-neutral-400 hover:text-white transition-colors disabled:opacity-40"
                  >
                    Hủy chọn
                  </button>
                  <button
                    id="btn-confirm-upload-pbf"
                    onClick={handleUpload}
                    disabled={isUploading}
                    className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-semibold text-xs rounded-xl shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {isUploading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin"></div>
                        <span>Đang truyền & xử lý PBF...</span>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-4 h-4" />
                        <span>Bắt đầu phân tích & Lập chỉ mục</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-5">
            {/* Presets Grid */}
            <div>
              <label className="text-xs font-bold text-neutral-300 uppercase tracking-wider block mb-2">
                Trích xuất PBF các đô thị lớn tại Việt Nam (BBBike Extract - Nạp 1 chạm)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  {
                    city: 'Hà Nội',
                    size: '~25 MB',
                    desc: 'Khu vực thủ đô Hà Nội và các vùng phụ cận',
                    url: 'https://download.bbbike.org/osm/bbbike/Hanoi/Hanoi.osm.pbf',
                  },
                  {
                    city: 'TP. Hồ Chí Minh',
                    size: '~28 MB',
                    desc: 'Toàn bộ đô thị TP. Hồ Chí Minh & các quận huyện',
                    url: 'https://download.bbbike.org/osm/bbbike/Saigon/Saigon.osm.pbf',
                  },
                  {
                    city: 'Đà Nẵng',
                    size: '~12 MB',
                    desc: 'Khu vực trung tâm miền Trung & bán đảo Sơn Trà',
                    url: 'https://download.bbbike.org/osm/bbbike/DaNang/DaNang.osm.pbf',
                  },
                ].map((preset) => (
                  <div
                    key={preset.city}
                    className="p-3.5 bg-neutral-850 rounded-xl border border-neutral-750 flex flex-col justify-between space-y-3"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-neutral-100">{preset.city}</span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-800 text-amber-300">
                          {preset.size}
                        </span>
                      </div>
                      <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                        {preset.desc}
                      </p>
                    </div>
                    <button
                      onClick={() => handleUrlImport(preset.url, `${preset.city}.osm.pbf`)}
                      disabled={isUrlImporting || isUploading}
                      className="w-full py-2 px-3 bg-neutral-800 hover:bg-amber-500 hover:text-neutral-950 text-neutral-200 text-xs font-semibold rounded-lg border border-neutral-700 hover:border-amber-400 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Nạp trích xuất {preset.city}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom URL Input */}
            <div className="p-4 bg-neutral-850 rounded-xl border border-neutral-750 space-y-3">
              <label className="text-xs font-bold text-neutral-300 uppercase tracking-wider block">
                Hoặc nhập URL trực tiếp (.osm.pbf)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  placeholder="https://example.com/vietnam-boundaries.osm.pbf"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  disabled={isUrlImporting}
                  className="flex-1 bg-neutral-950 border border-neutral-700 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-xs text-neutral-100 placeholder-neutral-500 focus:outline-none font-mono"
                />
                <button
                  onClick={() => handleUrlImport()}
                  disabled={isUrlImporting || !customUrl.trim()}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-semibold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
                >
                  {isUrlImporting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin"></div>
                      <span>Đang nạp trên Server...</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-4 h-4" />
                      <span>Tải & Lập chỉ mục</span>
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-neutral-400">
                Server sẽ tải luồng PBF về bộ nhớ đệm nội bộ và giải mã bằng protobuf-streamer mà không bị cản bởi giới hạn upload của trình duyệt.
              </p>
            </div>
          </div>
        )}

        {/* AI Studio Iframe Cookie Block Alert */}
        {isCookieBlocked && (
          <div className="mt-4 p-5 bg-gradient-to-r from-amber-950/60 via-neutral-900 to-red-950/40 border-2 border-amber-500/60 rounded-2xl shadow-2xl space-y-3">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                <ExternalLink className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <h4 className="text-sm font-bold text-amber-200">
                  Trình duyệt chặn Cookie bảo mật trong khung xem trước (iFrame)
                </h4>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Ứng dụng đang hiển thị trong khung iFrame nhúng của Google AI Studio. Trình duyệt (Chrome / Safari) tự động kích hoạt bảo mật chặn Cookie bên thứ 3 đối với tên miền máy chủ đám mây Cloud Run.
                </p>
                <div className="pt-2 flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-neutral-950 font-bold text-xs rounded-xl shadow-lg transition-all flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Mở ứng dụng ở Tab Mới để Tải File Ngay (Khuyên dùng)</span>
                  </button>
                  <button
                    onClick={() => {
                      setUploadMode('url');
                      setIsCookieBlocked(false);
                    }}
                    className="px-3.5 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs rounded-xl border border-neutral-700 transition-all flex items-center gap-1.5"
                  >
                    <Globe className="w-3.5 h-3.5 text-blue-400" />
                    <span>Nạp qua đường dẫn URL (Không phụ thuộc cookie trình duyệt)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Immediate Error Alert */}
        {errorMessage && !isCookieBlocked && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-3 text-xs text-red-300">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <div>
                <p className="font-bold text-red-200 text-sm">Lỗi xử lý file PBF</p>
                <p className="text-red-300/90 leading-relaxed mt-1">{errorMessage}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <a
                  href="#section-pbf-errors"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/40 rounded-lg text-xs font-semibold transition-colors"
                >
                  <Bug className="w-3.5 h-3.5 text-red-300" />
                  <span>Xem chi tiết chẩn đoán lỗi bên dưới</span>
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Immediate Success Alert */}
        {successInfo && (
          <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{successInfo.message}</span>
            </div>
            <p className="text-xs text-neutral-400">
              Đã lập chỉ mục <strong className="text-emerald-400">{successInfo.totalIndexed} đối tượng</strong> trong {successInfo.stats.durationMs} ms. Xem chi tiết bên dưới trong mục Chẩn đoán & Nhật ký lỗi.
            </p>
          </div>
        )}

        {/* Osmium Helper Guide Card */}
        <div className="mt-6 p-4 bg-neutral-850 rounded-xl border border-neutral-750 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h4 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">
                Mẹo tối ưu: Lọc ranh giới nhà cửa & hành chính bằng Osmium
              </h4>
            </div>
            <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium">
              Ranh giới nhà cửa + Hành chính
            </span>
          </div>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Để trích xuất riêng ranh giới nhà cửa (<code className="text-neutral-200 font-mono">building=*</code>) và phân cấp hành chính (<code className="text-neutral-200 font-mono">boundary=administrative</code>, <code className="text-neutral-200 font-mono">place</code>), loại bỏ đường giao thông nặng nề, bạn có thể chạy lệnh:
          </p>
          <div className="bg-neutral-950 p-3 rounded-lg border border-neutral-800 flex items-center justify-between gap-3 font-mono text-[11px] text-amber-300 overflow-x-auto">
            <code>osmium tags-filter vietnam-latest.osm.pbf building boundary=administrative place -o vietnam-buildings-admin.osm.pbf</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText('osmium tags-filter vietnam-latest.osm.pbf building boundary=administrative place -o vietnam-buildings-admin.osm.pbf');
              }}
              title="Sao chép lệnh"
              className="p-1.5 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-neutral-500">
            Lệnh sẽ lọc giữ lại 100% ranh giới đa giác các tòa nhà, chung cư, công trình và ranh giới hành chính, giúp kích thước file giảm hơn 70%, nạp nhanh và chuẩn xác.
          </p>
        </div>
      </div>

      {/* ======================================================== */}
      {/* 3. MỤC HIỆN LỖI XỬ LÝ FILE PBF (PBF ERROR & LOG MONITOR) */}
      {/* ======================================================== */}
      <div
        id="section-pbf-errors"
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
              <Bug className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-neutral-100">
                  Mục Hiện Lỗi & Nhật Ký Xử Lý File PBF
                </h3>
                {activeStats && activeStats.errorCount > 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-bold">
                    {activeStats.errorCount} Lỗi
                  </span>
                ) : activeStats && activeStats.warningCount > 0 ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
                    {activeStats.warningCount} Cảnh báo
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                    Trạng thái tốt
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Theo dõi chi tiết các lỗi giải mã Protobuf, node thiếu toạ độ, đường ranh giới hở hoặc không hợp lệ khi nạp file OSM.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-simulate-pbf-errors"
              onClick={handleSimulateDiagnostics}
              disabled={isSimulating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-750 text-neutral-300 hover:text-amber-400 border border-neutral-700 text-xs font-medium transition-colors"
              title="Tạo nhật ký và các trường hợp lỗi mẫu để kiểm tra giao diện"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>{isSimulating ? 'Đang tạo...' : 'Tạo lỗi mẫu thử nghiệm'}</span>
            </button>

            {activeStats && (
              <button
                id="btn-copy-error-logs"
                onClick={handleCopyLogs}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-750 text-neutral-300 hover:text-white border border-neutral-700 text-xs font-medium transition-colors"
                title="Sao chép toàn bộ nhật ký lỗi định dạng JSON"
              >
                {copiedLogs ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedLogs ? 'Đã sao chép' : 'Sao chép nhật ký'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Diagnostic Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div
            onClick={() => setFilterLevel('error')}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              filterLevel === 'error'
                ? 'bg-red-500/20 border-red-500/50'
                : 'bg-neutral-850/60 border-neutral-800 hover:border-red-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Lỗi nghiêm trọng</span>
              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            </div>
            <div className="text-xl font-bold text-red-400 font-mono mt-1">
              {activeStats?.errorCount || 0}
            </div>
          </div>

          <div
            onClick={() => setFilterLevel('warning')}
            className={`p-3 rounded-xl border cursor-pointer transition-all ${
              filterLevel === 'warning'
                ? 'bg-amber-500/20 border-amber-500/50'
                : 'bg-neutral-850/60 border-neutral-800 hover:border-amber-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Cảnh báo dữ liệu</span>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-xl font-bold text-amber-400 font-mono mt-1">
              {activeStats?.warningCount || 0}
            </div>
          </div>

          <div className="p-3 rounded-xl border bg-amber-500/10 border-amber-500/30">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-amber-300 font-semibold">Nhà/Tòa nhà dựng</span>
              <span className="text-xs">🏠</span>
            </div>
            <div className="text-xl font-bold text-amber-400 font-mono mt-1">
              {activeStats?.buildingsBuilt || 0}
            </div>
          </div>

          <div className="p-3 rounded-xl border bg-neutral-850/60 border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Ranh giới hành chính</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-emerald-400 font-mono mt-1">
              {activeStats?.adminBoundariesBuilt || 0}
            </div>
          </div>

          <div className="p-3 rounded-xl border bg-neutral-850/60 border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Way ranh giới bỏ qua</span>
              <span className="text-[10px] text-neutral-500 font-mono">&lt; 3 nodes</span>
            </div>
            <div className="text-xl font-bold text-neutral-200 font-mono mt-1">
              {activeStats?.skippedWaysCount || 0}
            </div>
          </div>

          <div className="p-3 rounded-xl border bg-neutral-850/60 border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-400">Node thiếu toạ độ</span>
              <span className="text-[10px] text-neutral-500 font-mono">Unresolved</span>
            </div>
            <div className="text-xl font-bold text-neutral-200 font-mono mt-1">
              {activeStats?.unresolvedNodesCount || 0}
            </div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {/* Level Filter Tabs */}
          <div className="flex items-center gap-1 bg-neutral-800 p-1 rounded-xl border border-neutral-750">
            <button
              onClick={() => setFilterLevel('all')}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                filterLevel === 'all'
                  ? 'bg-amber-500 text-neutral-950 font-bold'
                  : 'text-neutral-300 hover:text-white'
              }`}
            >
              Tất cả ({logsList.length})
            </button>
            <button
              onClick={() => setFilterLevel('error')}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                filterLevel === 'error'
                  ? 'bg-red-500 text-white font-bold'
                  : 'text-red-400 hover:text-red-300'
              }`}
            >
              <span>Lỗi ({logsList.filter((l) => l.level === 'error').length})</span>
            </button>
            <button
              onClick={() => setFilterLevel('warning')}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                filterLevel === 'warning'
                  ? 'bg-amber-500 text-neutral-950 font-bold'
                  : 'text-amber-400 hover:text-amber-300'
              }`}
            >
              <span>Cảnh báo ({logsList.filter((l) => l.level === 'warning').length})</span>
            </button>
            <button
              onClick={() => setFilterLevel('info')}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                filterLevel === 'info'
                  ? 'bg-neutral-700 text-white font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Thông tin ({logsList.filter((l) => l.level === 'info').length})
            </button>
          </div>

          {/* Search Box */}
          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm kiếm lỗi, Way ID, Node ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-xl text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Logs Feed Container */}
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {filteredLogs.length === 0 ? (
            <div className="p-8 text-center bg-neutral-850/40 rounded-xl border border-neutral-800 text-neutral-400">
              <CheckCircle2 className="w-8 h-8 text-emerald-400/80 mx-auto mb-2" />
              <p className="text-xs font-semibold text-neutral-200">
                Không có sự cố nào cần hiển thị cho bộ lọc hiện tại
              </p>
              <p className="text-[11px] text-neutral-500 mt-1">
                Các bản tin lỗi hoặc cảnh báo hình học sẽ tự động được ghi lại khi bạn tải file PBF.
              </p>
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const isError = log.level === 'error';
              const isWarning = log.level === 'warning';

              return (
                <div
                  key={log.id}
                  className={`p-3 rounded-xl border transition-all text-xs ${
                    isError
                      ? 'bg-red-500/5 border-red-500/25 hover:border-red-500/40'
                      : isWarning
                      ? 'bg-amber-500/5 border-amber-500/25 hover:border-amber-500/40'
                      : 'bg-neutral-850 border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  <div
                    className="flex items-start justify-between gap-3 cursor-pointer select-none"
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 shrink-0">
                        {isError ? (
                          <AlertCircle className="w-4 h-4 text-red-400" />
                        ) : isWarning ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                        ) : (
                          <Info className="w-4 h-4 text-blue-400" />
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                              isError
                                ? 'bg-red-500/20 text-red-300'
                                : isWarning
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-blue-500/20 text-blue-300'
                            }`}
                          >
                            {log.category.replace('_', ' ')}
                          </span>

                          {log.itemId && (
                            <span className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-amber-300 font-mono text-[10px]">
                              {log.itemId}
                            </span>
                          )}

                          <span className="text-[10px] text-neutral-500 font-mono">
                            {log.timestamp}
                          </span>
                        </div>

                        <p
                          className={`font-medium leading-relaxed ${
                            isError
                              ? 'text-red-200'
                              : isWarning
                              ? 'text-amber-200'
                              : 'text-neutral-200'
                          }`}
                        >
                          {log.message}
                        </p>
                      </div>
                    </div>

                    <button className="text-neutral-500 hover:text-neutral-300 mt-1 shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Expandable Details Box */}
                  {isExpanded && log.details && (
                    <div className="mt-3 pt-3 border-t border-neutral-800 text-[11px] text-neutral-300 space-y-1 bg-neutral-900/80 p-3 rounded-lg border border-neutral-800">
                      <div className="font-semibold text-neutral-400 flex items-center gap-1.5">
                        <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
                        <span>Chẩn đoán & Hướng dẫn xử lý:</span>
                      </div>
                      <p className="leading-relaxed text-neutral-300">{log.details}</p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Common PBF Parsing Errors Guide */}
        <div className="p-4 bg-neutral-950/70 rounded-xl border border-neutral-800 text-xs space-y-2">
          <div className="font-semibold text-neutral-200 flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-400" />
            <span>Các lỗi thường gặp và cách khắc phục khi chuẩn bị file OSM PBF</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-neutral-400 pt-1">
            <div className="space-y-1 bg-neutral-900/60 p-2.5 rounded-lg border border-neutral-850">
              <strong className="text-amber-300">1. Lỗi thiếu Node ranh giới (Unresolved Nodes):</strong>
              <p>
                Xảy ra khi trích xuất file theo hộp toạ độ (Bounding Box) làm đứt các đường ranh giới xuyên qua biên.
                <br />
                <span className="text-emerald-400">Cách sửa:</span> Dùng lệnh <code className="text-neutral-200 font-mono">osmium extract -b ... --complete-ways</code> hoặc nạp file trích xuất cả nước.
              </p>
            </div>

            <div className="space-y-1 bg-neutral-900/60 p-2.5 rounded-lg border border-neutral-850">
              <strong className="text-amber-300">2. Đa giác tự cắt chéo (Self-intersecting ring):</strong>
              <p>
                Do các điểm biên OSM bị vẽ đan chéo nhau khiến phép thử Point-in-Polygon (PIP) không xác định được bên trong/bên ngoài.
                <br />
                <span className="text-emerald-400">Cách sửa:</span> Hệ thống tự động lọc hoặc làm mịn vòng bao; có thể kiểm tra lại quan hệ trên JOSM.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Guide for obtaining Vietnam OSM PBF */}
      <div className="bg-neutral-900/70 border border-neutral-800 rounded-2xl p-6">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300 mb-3">
          <Info className="w-4 h-4 text-amber-400" />
          <span>Hướng dẫn tải file OSM PBF của Việt Nam</span>
        </div>

        <div className="space-y-3 text-xs text-neutral-400 leading-relaxed">
          <p>
            Bạn có thể tải file dữ liệu bản đồ OSM mới nhất của toàn lãnh thổ Việt Nam hoặc theo từng tỉnh/thành phố từ các kho lưu trữ công cộng uy tín:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <a
              href="https://download.geofabrik.de/asia/vietnam.html"
              target="_blank"
              rel="noreferrer"
              className="p-3 bg-neutral-850 hover:bg-neutral-800 rounded-xl border border-neutral-750 flex items-center justify-between group transition-colors"
            >
              <div>
                <div className="font-semibold text-neutral-200 group-hover:text-amber-400 flex items-center gap-1.5">
                  <span>Geofabrik Asia / Vietnam</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </div>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  File <code className="text-amber-300 font-mono">vietnam-latest.osm.pbf</code> cập nhật hàng ngày
                </p>
              </div>
            </a>

            <a
              href="https://extract.bbbike.org/"
              target="_blank"
              rel="noreferrer"
              className="p-3 bg-neutral-850 hover:bg-neutral-800 rounded-xl border border-neutral-750 flex items-center justify-between group transition-colors"
            >
              <div>
                <div className="font-semibold text-neutral-200 group-hover:text-amber-400 flex items-center gap-1.5">
                  <span>BBBike OSM Extracts</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </div>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  Trích xuất PBF nhanh theo thành phố: Hà Nội, TP. HCM, Đà Nẵng
                </p>
              </div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
