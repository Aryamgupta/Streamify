'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import LivePlayer from '../components/LivePlayer';
import { getApiUrl, getAuthHeaders } from '../utils/api';
import { Database, Activity, HardDrive, AlertOctagon, HelpCircle } from 'lucide-react';
import Link from 'next/link';

interface Camera {
  id: number;
  name: string;
  rtsp_url: string;
  enabled: number;
  online: boolean;
  recording: boolean;
}

interface StorageStats {
  total: number;
  free: number;
  used: number;
  percentUsed: number;
  alert: boolean;
}

interface SystemStatus {
  uptime: number;
  cpuLoad: number;
  memory: {
    percent: number;
  };
  cameras: {
    total: number;
    enabled: number;
    activeRecorders: number;
    activeStreams: number;
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const headers = getAuthHeaders();
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      // 1. Fetch Cameras
      const camRes = await fetch(getApiUrl('/api/cameras'), { headers });
      if (camRes.status === 401 || camRes.status === 403) {
        router.push('/login');
        return;
      }
      if (!camRes.ok) throw new Error('Failed to load camera data');
      const camData = await camRes.json();
      setCameras(camData);

      // 2. Fetch Storage
      const storageRes = await fetch(getApiUrl('/api/system/storage'), { headers });
      if (storageRes.ok) {
        const storageData = await storageRes.json();
        setStorage(storageData);
      }

      // 3. Fetch System Status
      const systemRes = await fetch(getApiUrl('/api/system/status'), { headers });
      if (systemRes.ok) {
        const systemData = await systemRes.json();
        setSystem(systemData);
      }

      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Connection to NVR backend lost. Reconnecting...');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Poll data every 5 seconds for live status updates
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  if (loading && cameras.length === 0) {
    return (
      <div className="flex-grow flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <p className="text-slate-400 text-sm font-semibold tracking-wide">Loading Dashboard...</p>
        </div>
      </div>
    );
  }

  // Create a grid list of length 4 (since we support up to 4 cameras)
  const gridCameras: (Camera | null)[] = [null, null, null, null];
  cameras.slice(0, 4).forEach((cam, index) => {
    gridCameras[index] = cam;
  });

  return (
    <div className="flex-grow w-full max-w-7xl mx-auto px-6 py-6 space-y-6">
      {/* Top Banner Warning: Disk Alert */}
      {storage?.alert && (
        <div className="flex items-center justify-between bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl text-xs font-semibold animate-pulse">
          <div className="flex items-center space-x-2.5">
            <AlertOctagon className="w-5 h-5 flex-shrink-0" />
            <div>
              <span className="font-bold uppercase tracking-wider">Storage Critical Alert:</span> NVR storage usage is at {storage.percentUsed.toFixed(1)}%. Expired recordings will be auto-purged, but consider expanding your USB HDD.
            </div>
          </div>
        </div>
      )}

      {/* Backend connection loss warning */}
      {error && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-3 rounded-xl text-xs font-semibold text-center">
          {error}
        </div>
      )}

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {gridCameras.map((camera, index) => {
          if (camera) {
            const hlsUrl = getApiUrl(`/live/cam-${camera.id}/index.m3u8`);
            const isCamOnline = camera.enabled === 1 && camera.online;
            return (
              <div key={camera.id} className="relative group rounded-xl overflow-hidden border border-slate-800 bg-slate-900/40 p-2.5">
                <div className="w-full aspect-video rounded-lg overflow-hidden">
                  <LivePlayer
                    streamUrl={hlsUrl}
                    cameraName={camera.name}
                    isOnline={isCamOnline}
                  />
                </div>
                
                {/* Under-player status bar */}
                <div className="flex justify-between items-center mt-2 px-1 text-slate-400 text-xs">
                  <div className="flex items-center space-x-2">
                    <span className={`w-2 h-2 rounded-full ${camera.enabled === 1 ? 'bg-emerald-500' : 'bg-slate-600'}`} />
                    <span className="font-semibold text-slate-300">{camera.name}</span>
                  </div>
                  
                  <div className="flex items-center space-x-3 text-[10px] font-bold tracking-wider uppercase">
                    {camera.enabled === 1 && camera.recording && (
                      <span className="flex items-center space-x-1 text-rose-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                        <span>REC</span>
                      </span>
                    )}
                    <span className={camera.enabled === 1 ? 'text-emerald-500' : 'text-slate-500'}>
                      {camera.enabled === 1 ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>
              </div>
            );
          } else {
            // Empty placeholder slot
            return (
              <div
                key={`empty-${index}`}
                className="flex flex-col items-center justify-center aspect-video bg-slate-900/10 border border-dashed border-slate-800/80 rounded-xl p-6 text-center group hover:border-slate-700/80 transition-colors"
              >
                <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-xl text-slate-500 group-hover:text-slate-400 transition-colors mb-3">
                  <HelpCircle className="w-6 h-6" />
                </div>
                <p className="text-slate-400 text-sm font-semibold">Camera Slot {index + 1}</p>
                <p className="text-slate-600 text-xs mt-1 max-w-xs">No camera configured in this slot.</p>
                <Link
                  href="/cameras"
                  className="mt-4 bg-slate-900/60 hover:bg-slate-900 hover:text-emerald-400 border border-slate-800 text-slate-400 px-4 py-2 rounded-xl text-xs font-semibold transition-all shadow-md"
                >
                  Configure Camera
                </Link>
              </div>
            );
          }
        })}
      </div>

      {/* Bottom Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Storage card */}
        <div className="flex items-center space-x-4 bg-slate-900/30 border border-slate-850 p-4 rounded-2xl shadow-lg">
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl">
            <HardDrive className="w-5 h-5" />
          </div>
          <div className="flex-grow">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">NVR NVR Storage</p>
            {storage ? (
              <div className="mt-2.5 space-y-1">
                <div className="flex justify-between items-baseline text-xs">
                  <span className="font-bold text-slate-200">{formatSize(storage.used)}</span>
                  <span className="text-slate-500 font-semibold">of {formatSize(storage.total)}</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${storage.alert ? 'bg-rose-500' : 'bg-emerald-500'}`}
                    style={{ width: `${storage.percentUsed}%` }}
                  />
                </div>
              </div>
            ) : (
              <span className="text-xs text-slate-500 font-semibold">Loading stats...</span>
            )}
          </div>
        </div>

        {/* Database recordings count card */}
        <div className="flex items-center space-x-4 bg-slate-900/30 border border-slate-855 p-4 rounded-2xl shadow-lg">
          <div className="bg-teal-500/10 border border-teal-500/20 text-teal-400 p-3 rounded-xl">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Active Recording Workers</p>
            <p className="text-2xl font-extrabold text-slate-100 tracking-tight mt-1">
              {system ? `${system.cameras.activeRecorders} / ${system.cameras.enabled}` : '0 / 0'}
            </p>
          </div>
        </div>

        {/* CPU and System load card */}
        <div className="flex items-center space-x-4 bg-slate-900/30 border border-slate-855 p-4 rounded-2xl shadow-lg">
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-xl">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-none">Pi Load Avg (1m)</p>
            <p className="text-2xl font-extrabold text-slate-100 tracking-tight mt-1">
              {system ? system.cpuLoad.toFixed(2) : '0.00'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
