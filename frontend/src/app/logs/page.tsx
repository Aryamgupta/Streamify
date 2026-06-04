'use client';

import React, { useEffect, useState } from 'react';
import { getApiUrl, getAuthHeaders } from '../../utils/api';
import { Activity, Clock, UserX, UserCheck, ChevronLeft, ChevronRight, Camera, X, Users } from 'lucide-react';

interface Detection {
  id: number;
  camera_id: number;
  camera_name: string;
  face_id: number | null;
  person_name: string | null;
  person_details: string | null;
  confidence: number;
  snapshot_path: string;
  timestamp: string;
}

interface PeopleLog {
  id: number;
  camera_id: number;
  camera_name: string;
  count: number;
  timestamp: string;
}

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<'faces' | 'people'>('faces');

  // Faces state
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);

  // People Counting state
  const [peopleLogs, setPeopleLogs] = useState<PeopleLog[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [peopleOffset, setPeopleOffset] = useState(0);

  const limit = 20;

  const fetchLogs = async (currentOffset: number) => {
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(getApiUrl(`/api/detections?limit=${limit}&offset=${currentOffset}`), { headers });
      
      if (!res.ok) throw new Error('Failed to load activity logs');
      
      const data = await res.json();
      setDetections(data.data);
      setTotal(data.pagination.total);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Could not connect to NVR backend to fetch face logs.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPeopleLogs = async (currentOffset: number) => {
    try {
      setPeopleLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(getApiUrl(`/api/detections/people-count-logs?limit=${limit}&offset=${currentOffset}`), { headers });
      
      if (!res.ok) throw new Error('Failed to load people count logs');
      
      const data = await res.json();
      setPeopleLogs(data.data);
      setPeopleTotal(data.pagination.total);
      setPeopleError(null);
    } catch (err: any) {
      console.error(err);
      setPeopleError('Could not connect to NVR backend to fetch people count logs.');
    } finally {
      setPeopleLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'faces') {
      fetchLogs(offset);
    } else {
      fetchPeopleLogs(peopleOffset);
    }
  }, [offset, peopleOffset, activeTab]);

  const handleNext = () => {
    if (activeTab === 'faces') {
      if (offset + limit < total) setOffset(offset + limit);
    } else {
      if (peopleOffset + limit < peopleTotal) setPeopleOffset(peopleOffset + limit);
    }
  };

  const handlePrev = () => {
    if (activeTab === 'faces') {
      if (offset - limit >= 0) setOffset(offset - limit);
    } else {
      if (peopleOffset - limit >= 0) setPeopleOffset(peopleOffset - limit);
    }
  };

  const currentLoading = activeTab === 'faces' ? loading : peopleLoading;
  const currentError = activeTab === 'faces' ? error : peopleError;
  const currentOffset = activeTab === 'faces' ? offset : peopleOffset;
  const currentTotal = activeTab === 'faces' ? total : peopleTotal;
  const isEmpty = activeTab === 'faces' ? detections.length === 0 : peopleLogs.length === 0;

  return (
    <div className="flex-grow w-full max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center space-x-3">
            <Activity className="w-7 h-7 text-emerald-400" />
            <span>Activity Logs & Detections</span>
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Historical log of AI face detection and people counting events.
          </p>
        </div>
        
        {/* Tabs */}
        <div className="flex space-x-2 bg-slate-900/50 p-1 rounded-xl w-fit border border-slate-800">
          <button 
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'faces' ? 'bg-slate-800 text-emerald-400 shadow' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('faces')}
          >
            Face Detections
          </button>
          <button 
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'people' ? 'bg-slate-800 text-emerald-400 shadow' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('people')}
          >
            People Counting
          </button>
        </div>
      </div>

      {currentError && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl text-sm font-semibold">
          {currentError}
        </div>
      )}

      {currentLoading && isEmpty ? (
        <div className="flex justify-center items-center py-20">
          <div className="w-10 h-10 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/60 border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-400">
                  {activeTab === 'faces' ? (
                    <>
                      <th className="px-6 py-4 font-bold">Snapshot</th>
                      <th className="px-6 py-4 font-bold">Identity</th>
                      <th className="px-6 py-4 font-bold">Location</th>
                      <th className="px-6 py-4 font-bold">Confidence</th>
                      <th className="px-6 py-4 font-bold">Time Detected</th>
                    </>
                  ) : (
                    <>
                      <th className="px-6 py-4 font-bold w-20 text-center">Event</th>
                      <th className="px-6 py-4 font-bold">Location</th>
                      <th className="px-6 py-4 font-bold">People Count</th>
                      <th className="px-6 py-4 font-bold">Time Detected</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-sm">
                {!isEmpty ? (
                  activeTab === 'faces' ? (
                    detections.map((log) => {
                      const isUnknown = log.face_id === null;
                      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
                      const imageUrl = getApiUrl(`/snapshots/${log.snapshot_path}?token=${token}`);
                      
                      return (
                        <tr 
                          key={log.id} 
                          className="hover:bg-slate-800/30 transition-colors cursor-pointer"
                          onClick={() => setSelectedDetection(log)}
                        >
                          <td className="px-6 py-4">
                            <div className="w-16 h-16 rounded-xl overflow-hidden bg-black border border-slate-800">
                              <img src={imageUrl} alt="Detection snapshot" className="w-full h-full object-cover" />
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-3">
                              {isUnknown ? (
                                <div className="p-2 bg-rose-500/10 text-rose-400 rounded-lg">
                                  <UserX className="w-5 h-5" />
                                </div>
                              ) : (
                                <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                                  <UserCheck className="w-5 h-5" />
                                </div>
                              )}
                              <div>
                                <p className={`font-bold ${isUnknown ? 'text-rose-400' : 'text-slate-200'}`}>
                                  {isUnknown ? 'Unrecognized Person' : log.person_name}
                                </p>
                                {!isUnknown && log.person_details && (
                                  <p className="text-xs text-slate-500 mt-0.5">{log.person_details}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-slate-300 font-medium flex items-center space-x-2">
                            <Camera className="w-4 h-4 text-slate-500" />
                            <span>{log.camera_name}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2.5 py-1 bg-slate-900 border border-slate-700 rounded-md text-xs font-semibold text-slate-300">
                              {Math.round(log.confidence * 100)}% Match
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-400">
                            <div className="flex items-center space-x-2">
                              <Clock className="w-4 h-4 text-slate-500" />
                              <span>{new Date(log.timestamp).toLocaleString()}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    peopleLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4 text-center">
                          <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg inline-flex">
                            <Users className="w-5 h-5" />
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-300 font-medium">
                          <div className="flex items-center space-x-2">
                            <Camera className="w-4 h-4 text-slate-500" />
                            <span>{log.camera_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1.5 bg-blue-500/20 border border-blue-500/30 rounded-lg text-sm font-bold text-blue-400">
                            {log.count} {log.count === 1 ? 'Person' : 'People'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-400">
                          <div className="flex items-center space-x-2">
                            <Clock className="w-4 h-4 text-slate-500" />
                            <span>{new Date(log.timestamp).toLocaleString()}</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )
                ) : (
                  <tr>
                    <td colSpan={activeTab === 'faces' ? 5 : 4} className="px-6 py-12 text-center text-slate-500 font-semibold">
                      No activity logs recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/30 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-semibold">
              Showing {currentTotal === 0 ? 0 : currentOffset + 1} to {Math.min(currentOffset + limit, currentTotal)} of {currentTotal} entries
            </span>
            <div className="flex items-center space-x-2">
              <button
                onClick={handlePrev}
                disabled={currentOffset === 0}
                className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNext}
                disabled={currentOffset + limit >= currentTotal}
                className="p-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal for full details */}
      {selectedDetection && activeTab === 'faces' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm" onClick={() => setSelectedDetection(null)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <h3 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
                <Camera className="w-5 h-5 text-emerald-400" />
                <span>Detection Details</span>
              </h3>
              <button onClick={() => setSelectedDetection(null)} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div className="w-full rounded-xl overflow-hidden bg-black border border-slate-800 aspect-video relative">
                <img 
                  src={getApiUrl(`/snapshots/${selectedDetection.snapshot_path}?token=${typeof window !== 'undefined' ? localStorage.getItem('token') : null}`)} 
                  alt="Full Detection snapshot" 
                  className="w-full h-full object-contain" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <p className="text-slate-500 font-semibold uppercase tracking-wider text-xs">Identity</p>
                  <p className={`font-bold text-lg ${selectedDetection.face_id === null ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {selectedDetection.face_id === null ? 'Unrecognized Person' : selectedDetection.person_name}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-slate-500 font-semibold uppercase tracking-wider text-xs">Confidence Match</p>
                  <p className="font-bold text-slate-200">{Math.round(selectedDetection.confidence * 100)}%</p>
                </div>
                <div className="space-y-1">
                  <p className="text-slate-500 font-semibold uppercase tracking-wider text-xs">Location</p>
                  <p className="font-bold text-slate-200">{selectedDetection.camera_name}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-slate-500 font-semibold uppercase tracking-wider text-xs">Time Detected</p>
                  <p className="font-bold text-slate-200">{new Date(selectedDetection.timestamp).toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
