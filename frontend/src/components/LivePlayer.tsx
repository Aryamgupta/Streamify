'use client';

import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import {  RotateCcw, AlertTriangle, Users } from 'lucide-react';

interface LivePlayerProps {
  streamUrl: string; // URL to the index.m3u8 file
  cameraName: string;
  isOnline: boolean;
  peopleCount?: number;
}

export default function LivePlayer({ streamUrl, cameraName, isOnline, peopleCount }: LivePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const initPlayer = () => {
    if (!videoRef.current) return;
    setError(null);
    setLoading(true);

    const token = localStorage.getItem('token');
    
    // Clean up existing Hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const video = videoRef.current;

    // Hls.js support (preferred as it handles header injection for chunks)
    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 2,
        maxMaxBufferLength: 4,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 2,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 0,
        xhrSetup: (xhr) => {
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
        }
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS network error, attempting recovery...', data);
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS media error, attempting recovery...', data);
              hls.recoverMediaError();
              break;
            default:
              setError('Stream disconnected or offline');
              setLoading(false);
              hls.destroy();
              hlsRef.current = null;
              break;
          }
        }
      });
    }
    // Direct HLS support in browser (Safari/iOS fallback)
    else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // For native playback, we pass the token in query string since we cannot set headers
      const urlWithToken = token ? `${streamUrl}?token=${token}` : streamUrl;
      video.src = urlWithToken;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.play().catch(() => {});
      });
      video.addEventListener('error', () => {
        setError('Failed to play stream (native HLS error)');
        setLoading(false);
      });
    } else {
      setError('Your browser does not support HLS streaming');
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOnline) {
      // Small timeout to allow files to populate if just enabled
      const timer = setTimeout(() => {
        initPlayer();
      }, 1000);
      return () => {
        clearTimeout(timer);
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    } else {
      setLoading(false);
      setError('Camera is offline or disabled');
    }
  }, [streamUrl, isOnline]);

  const handleRetry = () => {
    initPlayer();
  };

  return (
    <div className="relative w-full h-full aspect-video bg-black rounded-lg overflow-hidden border border-slate-800 shadow-lg group">
      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        autoPlay
      />

      {/* Overlay - Camera Name */}
      <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur px-3 py-1.5 rounded-md text-xs font-semibold text-white tracking-wide border border-slate-800 pointer-events-none">
        {cameraName}
      </div>

      {/* Overlay - Status indicator */}
      <div className="absolute top-3 right-3 flex items-center space-x-1.5 bg-slate-950/80 backdrop-blur px-2.5 py-1.5 rounded-md text-xs font-medium border border-slate-800 pointer-events-none">
        <span className={`w-2 h-2 rounded-full ${isOnline && !error ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
        <span className="text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
          {isOnline && !error ? 'Live' : 'Offline'}
        </span>
      </div>

      {/* Overlay - Live People Count */}
      {peopleCount !== undefined && (
        <div className="absolute bottom-3 right-3 flex items-center space-x-1.5 bg-blue-500/80 backdrop-blur px-2.5 py-1.5 rounded-md text-xs font-medium border border-blue-500/50 pointer-events-none text-white shadow-lg">
          <Users className="w-3.5 h-3.5" />
          <span className="font-bold">{peopleCount}</span>
        </div>
      )}

      {/* Loader */}
      {loading && (
        <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center space-y-3 z-10 transition-opacity">
          <div className="w-8 h-8 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          <p className="text-slate-400 text-xs font-medium">Connecting to stream...</p>
        </div>
      )}

      {/* Error / Placeholder */}
      {(!isOnline || error) && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center space-y-4 z-10 px-6 text-center">
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-full text-rose-500">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <p className="text-slate-200 text-sm font-semibold">{error || 'Camera Offline'}</p>
            <p className="text-slate-500 text-xs max-w-xs">
              {!isOnline 
                ? 'Enable the camera or check its connection in Camera Settings.' 
                : 'Could not connect to the stream. Click retry to reconnect.'}
            </p>
          </div>
          {isOnline && (
            <button
              onClick={handleRetry}
              className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all shadow-md"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry Connection</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
