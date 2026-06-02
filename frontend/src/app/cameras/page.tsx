'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiUrl, getAuthHeaders } from '../../utils/api';
import { Camera, Plus, Trash2, Edit2, Play, RotateCcw, AlertTriangle, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';

interface CameraItem {
  id: number;
  name: string;
  rtsp_url: string;
  enabled: number;
  online: boolean;
  recording: boolean;
}

export default function CamerasPage() {
  const router = useRouter();
  const [cameras, setCameras] = useState<CameraItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [enabled, setEnabled] = useState(1);
  const [skipTest, setSkipTest] = useState(false);

  // Testing connection states
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'online' | 'offline' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchCameras = async () => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(getApiUrl('/api/cameras'), { headers });
      
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error('Failed to load cameras list');
      
      const data = await res.json();
      setCameras(data);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Could not connect to NVR backend');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCameras();
    // Poll camera status updates
    const interval = setInterval(fetchCameras, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleTestConnection = async () => {
    if (!rtspUrl.trim()) {
      setFormError('Source/RTSP URL is required to run a test');
      return;
    }

    setTesting(true);
    setTestResult(null);
    setFormError(null);

    try {
      const res = await fetch(getApiUrl('/api/cameras/test'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ rtsp_url: rtspUrl })
      });

      const data = await res.json();
      if (res.ok) {
        setTestResult(data.online ? 'online' : 'offline');
      } else {
        setFormError(data.error || 'Connection test failed');
      }
    } catch (err) {
      setFormError('Network error during connection test');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rtspUrl.trim()) {
      setFormError('Please fill out all fields.');
      return;
    }

    setSaving(true);
    setFormError(null);

    const method = isEditing ? 'PUT' : 'POST';
    const endpoint = isEditing ? `/api/cameras/${editingId}` : '/api/cameras';

    try {
      const res = await fetch(getApiUrl(endpoint), {
        method,
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          rtsp_url: rtspUrl,
          enabled,
          skipTest: skipTest || !enabled // automatically skip test if saving a disabled camera
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save camera settings');
      }

      // Success
      resetForm();
      fetchCameras();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnable = async (camera: CameraItem) => {
    const updatedEnabled = camera.enabled === 1 ? 0 : 1;
    try {
      const res = await fetch(getApiUrl(`/api/cameras/${camera.id}`), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: camera.name,
          rtsp_url: camera.rtsp_url,
          enabled: updatedEnabled,
          skipTest: true // skip test for toggle updates
        })
      });

      if (res.ok) {
        fetchCameras();
      }
    } catch (err) {
      console.error('Error toggling camera status:', err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this camera? All its associated recording records and files will be permanently deleted.')) {
      return;
    }

    try {
      const res = await fetch(getApiUrl(`/api/cameras/${id}`), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete camera');
      }

      fetchCameras();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const startEdit = (camera: CameraItem) => {
    setIsEditing(true);
    setEditingId(camera.id);
    setName(camera.name);
    setRtspUrl(camera.rtsp_url);
    setEnabled(camera.enabled);
    setSkipTest(false);
    setTestResult(null);
    setFormError(null);
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditingId(null);
    setName('');
    setRtspUrl('');
    setEnabled(1);
    setSkipTest(false);
    setTestResult(null);
    setFormError(null);
  };

  return (
    <div className="flex-grow w-full max-w-7xl mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-start gap-6">
        {/* Left Side - Cameras List */}
        <div className="w-full md:w-3/5 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-100 uppercase">Camera Directory</h2>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Manage active recording inputs</p>
            </div>
            {cameras.length >= 4 && (
              <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wider bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-md">
                Max slots filled (4/4)
              </span>
            )}
          </div>

          {error && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 p-3 rounded-xl text-xs font-semibold">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center p-12 bg-slate-900/10 border border-slate-900 rounded-xl">
              <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
            </div>
          ) : cameras.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 bg-slate-900/10 border border-dashed border-slate-900 rounded-xl text-center">
              <div className="p-3 bg-slate-900/50 rounded-xl text-slate-500 mb-3 border border-slate-800">
                <Camera className="w-6 h-6" />
              </div>
              <p className="text-slate-400 text-sm font-semibold">No Cameras Configured</p>
              <p className="text-slate-650 text-xs mt-1">Configure your first RTSP stream using the form on the right.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cameras.map((camera) => (
                <div
                  key={camera.id}
                  className="flex items-center justify-between p-4 bg-slate-900/30 border border-slate-850 hover:border-slate-800 rounded-2xl transition-all shadow-md"
                >
                  <div className="flex items-center space-x-3.5 min-w-0">
                    <div className={`p-2.5 rounded-xl border ${
                      camera.enabled === 1 && camera.online 
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                        : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`}>
                      <Camera className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-slate-200 text-sm truncate">{camera.name}</h4>
                      <p className="text-xs text-slate-500 font-mono truncate max-w-xs sm:max-w-md">{camera.rtsp_url}</p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    {/* Status badge */}
                    <div className="flex flex-col items-end">
                      <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                        camera.enabled === 1 
                          ? camera.online 
                            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                            : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                          : 'bg-slate-800 border border-slate-700 text-slate-400'
                      }`}>
                        {camera.enabled === 1 ? (camera.online ? 'Online' : 'Offline') : 'Disabled'}
                      </span>
                      {camera.enabled === 1 && camera.recording && (
                        <span className="text-[8px] font-bold text-rose-500 uppercase tracking-widest mt-1 flex items-center space-x-0.5">
                          <span className="w-1 h-1 rounded-full bg-rose-500 animate-ping" />
                          <span>Recording</span>
                        </span>
                      )}
                    </div>

                    {/* Enable Toggle */}
                    <button
                      onClick={() => handleToggleEnable(camera)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        camera.enabled === 1 ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-slate-950 shadow ring-0 transition duration-200 ease-in-out ${
                          camera.enabled === 1 ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>

                    {/* Action buttons */}
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => startEdit(camera)}
                        className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-slate-800/50 rounded-lg transition-colors"
                        title="Edit Camera"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(camera.id)}
                        className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800/50 rounded-lg transition-colors"
                        title="Delete Camera"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Side - Add/Edit Form */}
        <div className="w-full md:w-2/5">
          <div className="bg-slate-900/30 border border-slate-850 p-6 rounded-2xl shadow-xl space-y-5">
            <div>
              <h3 className="text-md font-bold tracking-tight text-slate-200 uppercase">
                {isEditing ? 'Modify Camera Settings' : 'Register New Camera'}
              </h3>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">
                {isEditing ? 'Apply revisions to settings' : 'Bind a new feed to the NVR'}
              </p>
            </div>

            {formError && (
              <div className="flex items-center space-x-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl text-xs font-semibold">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Camera Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-slate-200 placeholder-slate-650 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors"
                  placeholder="e.g. Front Gate Driveway"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">RTSP/Stream URL</label>
                <input
                  type="text"
                  required
                  value={rtspUrl}
                  onChange={(e) => setRtspUrl(e.target.value)}
                  className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-slate-200 placeholder-slate-650 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors font-mono"
                  placeholder="rtsp://username:password@ip:port/h264"
                />
                <p className="text-[10px] font-medium text-slate-500">
                  For local file simulation (mock mode), specify a local video file path (e.g. <code className="text-slate-400 font-mono">/home/aryam/Documents/cctv-analysis/mock-media/test.mp4</code>).
                </p>
              </div>

              <div className="flex items-center space-x-3 bg-slate-950/40 p-3 rounded-xl border border-slate-850">
                <input
                  id="enabledCheckbox"
                  type="checkbox"
                  checked={enabled === 1}
                  onChange={(e) => setEnabled(e.target.checked ? 1 : 0)}
                  className="w-4 h-4 text-emerald-500 bg-slate-950 border-slate-850 rounded focus:ring-emerald-500"
                />
                <label htmlFor="enabledCheckbox" className="text-xs font-semibold text-slate-300 select-none">
                  Enable camera and start recording immediately
                </label>
              </div>

              {/* Connection Tester Widget */}
              {enabled === 1 && (
                <div className="p-4 bg-slate-950/60 border border-slate-850 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Stream Connection Test</span>
                    <button
                      type="button"
                      disabled={testing || !rtspUrl.trim()}
                      onClick={handleTestConnection}
                      className="bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wide uppercase transition-all shadow-sm flex items-center space-x-1"
                    >
                      {testing ? (
                        <>
                          <div className="w-3 h-3 border border-slate-400/20 border-t-slate-300 rounded-full animate-spin" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw className="w-3 h-3" />
                          <span>Run Probe Test</span>
                        </>
                      )}
                    </button>
                  </div>

                  {testResult && (
                    <div className={`flex items-center space-x-2 text-xs font-semibold p-2.5 rounded-lg border ${
                      testResult === 'online'
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                    }`}>
                      {testResult === 'online' ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                          <span>Connection established! Valid video stream detected.</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 flex-shrink-0" />
                          <span>Stream unreachable. Check address, network, or password.</span>
                        </>
                      )}
                    </div>
                  )}

                  {testResult === 'offline' && (
                    <div className="flex items-start space-x-2 bg-amber-500/5 p-2.5 rounded-lg border border-amber-500/15">
                      <input
                        id="skipTestCheckbox"
                        type="checkbox"
                        checked={skipTest}
                        onChange={(e) => setSkipTest(e.target.checked)}
                        className="w-3.5 h-3.5 mt-0.5 text-emerald-500 bg-slate-950 border-slate-850 rounded focus:ring-emerald-500"
                      />
                      <label htmlFor="skipTestCheckbox" className="text-[10px] font-semibold text-slate-400 select-none">
                        Ignore connectivity warning and save camera configuration anyway.
                      </label>
                    </div>
                  )}
                </div>
              )}

              {/* Form buttons */}
              <div className="flex space-x-2.5 pt-2">
                <button
                  type="submit"
                  disabled={saving || (enabled === 1 && testResult === 'offline' && !skipTest)}
                  className="flex-grow flex justify-center bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 active:from-emerald-700 active:to-teal-700 disabled:opacity-50 text-slate-950 px-4 py-3 rounded-xl text-xs font-bold tracking-wider uppercase transition-all shadow-md"
                >
                  {saving ? 'Saving Config...' : isEditing ? 'Apply Changes' : 'Register Camera'}
                </button>

                {isEditing && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 px-4 py-3 rounded-xl text-xs font-semibold transition-all"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
