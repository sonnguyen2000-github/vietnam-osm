/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { MapView } from './components/MapView';
import { LookupPanel } from './components/LookupPanel';
import { ApiDocsView } from './components/ApiDocsView';
import { UploadView } from './components/UploadView';
import { DatasetStatus, ReverseGeocodeResult, OSMPlace } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<'map' | 'api' | 'upload'>('map');
  const [status, setStatus] = useState<DatasetStatus | null>(null);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lon: number }>({
    lat: 21.0287,
    lon: 105.8524,
  });
  const [currentResult, setCurrentResult] = useState<ReverseGeocodeResult | null>(null);
  const [selectedPlace, setSelectedPlace] = useState<OSMPlace | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Fetch lightweight metadata only. Map layers are loaded by viewport in MapView.
  const fetchStatus = async () => {
    try {
      const statusRes = await fetch('/api/status');
      if (statusRes.ok) {
        const json = await statusRes.json();
        if (json.success) setStatus(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch dataset status:', err);
    }
  };

  // Perform reverse geocode query
  const handleSearch = async (
    lat: number,
    lon: number,
    order: 'narrow_to_broad' | 'broad_to_narrow' = 'narrow_to_broad'
  ) => {
    setIsLoading(true);
    setCurrentCoords({ lat, lon });

    try {
      const res = await fetch(`/api/lookup?lat=${lat}&lon=${lon}&order=${order}`);
      const json = await res.json();
      if (json.success) {
        setCurrentResult(json.data);
      }
    } catch (err) {
      console.error('Failed to reverse geocode coordinate:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Map click handler
  const handleMapClick = (lat: number, lon: number) => {
    handleSearch(lat, lon, currentResult?.query.order || 'narrow_to_broad');
  };

  // Reset to default Vietnam dataset
  const handleResetDefault = async () => {
    setIsResetting(true);
    try {
      const res = await fetch('/api/reset-default', { method: 'POST' });
      const json = await res.json();
      if (json.success && json.dataset) {
        setStatus(json.dataset);
        await fetchStatus();
        // Re-query current coordinates
        handleSearch(currentCoords.lat, currentCoords.lon);
      }
    } catch (err) {
      console.error('Failed to reset dataset:', err);
    } finally {
      setIsResetting(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Run initial search for default coordinate
    handleSearch(21.0287, 105.8524, 'narrow_to_broad');
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        status={status}
        onResetDefault={handleResetDefault}
        isResetting={isResetting}
      />

      {/* Main Content Area */}
      <main className="flex-1 p-3 md:p-5 flex flex-col max-w-[1700px] w-full mx-auto">
        {activeTab === 'map' && (
          <div className="flex-1 flex flex-col lg:flex-row gap-4 h-[calc(100vh-80px)] min-h-[600px]">
            {/* Visual Map Component */}
            <MapView
              dataVersion={status?.uploadedAt}
              activeCoord={currentCoords}
              onMapClick={handleMapClick}
              highlightedPlaces={currentResult?.places || []}
              currentResult={currentResult}
              selectedPlace={selectedPlace}
              onSelectPlace={setSelectedPlace}
            />

            {/* Coordinate Lookup & Hierarchy Inspector Panel */}
            <LookupPanel
              currentResult={currentResult}
              isLoading={isLoading}
              onSearch={handleSearch}
              presetCoordinates={status?.sampleCoordinates || []}
              currentCoords={currentCoords}
              onSelectPlace={setSelectedPlace}
            />
          </div>
        )}

        {activeTab === 'api' && (
          <div className="py-2">
            <ApiDocsView />
          </div>
        )}

        {activeTab === 'upload' && (
          <div className="py-2">
            <UploadView
              status={status}
              onUploadSuccess={(newStatus) => {
                setStatus(newStatus);
                fetchStatus();
                handleSearch(currentCoords.lat, currentCoords.lon);
              }}
              onResetDefault={handleResetDefault}
              isResetting={isResetting}
            />
          </div>
        )}
      </main>
    </div>
  );
}
