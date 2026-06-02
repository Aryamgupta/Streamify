'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiUrl, getAuthHeaders } from '../../utils/api';
import { Film, Calendar, Camera, Play, Download, Search, HardDrive, Clock } from 'lucide-react';

interface Recording {
  id: number;
  camera_id: number;
  camera_name: string;
  file_path: string;
  start_time: string;
  end_time: string;
  size: number;
}

interface CameraItem {
  id: number;
  name: string;
}

export default function RecordingsPage() {
  const router = useRouter();
  
  // List states
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');

  // Active video state
  const [activeRecording, setActiveRecording] = useState<Recording | null>(null);

  // Format helper to get today's date in YYYY-MM-DD
  const getTodayString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const fetchFilters = async () => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(getApiUrl('/api/cameras'), { headers });
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setCameras(data);
      }
    } catch (err) {
      console.error('Error fetching cameras filter:', err);
    }
  };

  const fetchRecordings = async () => {
    setLoading(true);
    try {
      const headers = getAuthHeaders();
      let url = getApiUrl('/api/recordings?');
      if (selectedCamera) url += `camera_id=${selectedCamera}&`;
      if (selectedDate) url += `date=${selectedDate}&`;

      const res = await fetch(url, { headers });
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error('Failed to load recordings');
      
      const data = await res.json();
      setRecordings(data);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Failed to fetch recordings directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedDate(getTodayString());
    fetchFilters();
  }, []);

  useEffect(() => {
    if (selectedDate !== '') {
      fetchRecordings();
    }
  }, [selectedCamera, selectedDate]);

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const handleSelectRecording = (rec: Recording) => {
    setActiveRecording(rec);
  };

  // Get video play URL containing token query string (for range capabilities in native audio/video elements)
  const getVideoUrl = (recordingId: number) => {
    const token = localStorage.getItem('token');
    return getApiUrl(`/api/recordings/video/${recordingId}?token=${token}`);
  };

  return (
    <div className="flex-grow w-full max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row gap-6 min-h-0">
      {/* Sidebar Filter Panel */}
      <div className="w-full md:w-80 flex-shrink-0 space-y-4">
        <div className="bg-slate-900/30 border border-slate-850 p-5 rounded-2xl shadow-xl space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-tight">Recordings Search</h3>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Filter NVR segment archives</p>
          </div>

          <div className="space-y-4">
            {/* Camera Select */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                <Camera className="w-3.5 h-3.5 text-slate-500" />
                <span>Select Camera</span>
              </label>
              <select
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none transition-colors"
              >
                <option value="">All Cameras</option>
                {cameras.map((cam) => (
                  <option key={cam.id} value={cam.id}>
                    {cam.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Picker */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>Select Date</span>
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Catalog List */}
        <div className="bg-slate-900/30 border border-slate-850 p-5 rounded-2xl shadow-xl flex flex-col h-[400px] md:h-[calc(100vh-340px)] min-h-0">
          <div>
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-tight flex items-center justify-between">
              <span>Segments Catalog</span>
              <span className="text-[9px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-bold">
                {recordings.length}
              </span>
            </h3>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Click a segment to play</p>
          </div>

          <div className="flex-grow overflow-y-auto mt-4 pr-1 space-y-2 scrollbar-thin">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="w-5 h-5 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
              </div>
            ) : recordings.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-slate-500 text-xs font-semibold">No recordings found</p>
                <p className="text-[10px] text-slate-600 mt-1 max-w-[200px] mx-auto">Try selecting another camera or date folder.</p>
              </div>
            ) : (
              recordings.map((rec) => {
                const isActive = activeRecording?.id === rec.id;
                return (
                  <button
                    key={rec.id}
                    onClick={() => handleSelectRecording(rec)}
                    className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                      isActive
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-slate-950/40 border-slate-850 text-slate-300 hover:border-slate-800'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
                        {rec.camera_name}
                      </p>
                      <p className="text-xs font-semibold mt-0.5 flex items-center space-x-1">
                        <Clock className="w-3 h-3 flex-shrink-0 opacity-70" />
                        <span>{formatTime(rec.start_time)}</span>
                      </p>
                    </div>

                    <div className="text-right flex-shrink-0 text-[10px] text-slate-500 font-bold uppercase">
                      <span>{formatSize(rec.size)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Main Playback Area */}
      <div className="flex-grow bg-slate-900/10 border border-slate-850 p-6 rounded-3xl shadow-xl flex flex-col justify-between">
        {activeRecording ? (
          <div className="flex-grow flex flex-col h-full justify-between space-y-4">
            {/* Player Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-200 uppercase tracking-tight">{activeRecording.camera_name}</h2>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mt-0.5 flex items-center space-x-1.5">
                  <span>Start: {new Date(activeRecording.start_time).toLocaleString()}</span>
                  <span>•</span>
                  <span>Size: {formatSize(activeRecording.size)}</span>
                </p>
              </div>

              {/* Download */}
              <a
                href={getVideoUrl(activeRecording.id)}
                download={`${activeRecording.camera_name}_${activeRecording.start_time}.mp4`}
                className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-slate-700 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all shadow-md"
              >
                <Download className="w-4 h-4" />
                <span>Save MP4</span>
              </a>
            </div>

            {/* Video Canvas Container */}
            <div className="flex-grow bg-black rounded-2xl overflow-hidden aspect-video border border-slate-950 shadow-2xl relative flex items-center justify-center">
              <video
                key={activeRecording.id}
                src={getVideoUrl(activeRecording.id)}
                controls
                autoPlay
                className="w-full h-full object-contain"
              />
            </div>

            {/* Timeline Info Panel */}
            <div className="flex items-center space-x-3.5 bg-slate-900/30 p-4 rounded-xl border border-slate-850 text-xs text-slate-400">
              <HardDrive className="w-5 h-5 text-slate-500 flex-shrink-0" />
              <div>
                <span className="font-bold text-slate-300">Storage Location:</span>
                <span className="font-mono ml-2 text-slate-500 text-[10px] break-all">{activeRecording.file_path}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-grow flex flex-col items-center justify-center py-24 text-center space-y-4">
            <div className="p-4 bg-slate-900/50 rounded-2xl text-slate-500 border border-slate-800 shadow-inner">
              <Film className="w-8 h-8" />
            </div>
            <div className="space-y-1">
              <h4 className="text-slate-300 text-sm font-semibold uppercase tracking-wider">No Recording Selected</h4>
              <p className="text-slate-500 text-xs max-w-sm">
                Pick a camera and date on the left, then select a time segment block to initialize the video player.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
