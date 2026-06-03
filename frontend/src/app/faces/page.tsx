'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiUrl, getAuthHeaders } from '../../utils/api';
import { Users, Upload, Trash2, ShieldAlert, CheckCircle, Clock, Info, UserPlus } from 'lucide-react';

interface FaceProfile {
  id: number;
  name: string;
  details: string | null;
  image_path: string;
  trained: number; // returned as trained boolean expression (0 or 1)
  created_at: string;
}

export default function FacesPage() {
  const router = useRouter();
  const [faces, setFaces] = useState<FaceProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userRole, setUserRole] = useState('viewer');

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const fetchFaces = async () => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch(getApiUrl('/api/faces'), { headers });
      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch face profiles');
      const data = await res.json();
      setFaces(data);
    } catch (err: any) {
      console.error(err);
      setError('Could not load face directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        setUserRole(u.role);
      } catch {}
    }
    fetchFaces();

    // Poll to update 'trained' state of newly uploaded faces
    const interval = setInterval(fetchFaces, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImageFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!imageFile) {
      setError('Reference image is required');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('details', details.trim());
      formData.append('image', imageFile);

      const res = await fetch(getApiUrl('/api/faces'), {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: formData
      });

      if (res.status === 401 || res.status === 403) {
        router.push('/login');
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register face');

      setSuccess('Face profile uploaded successfully. AI training in progress.');
      setName('');
      setDetails('');
      setImageFile(null);
      
      // Reset file input
      const fileInput = document.getElementById('face-image-input') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

      fetchFaces();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to submit face profile');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this face profile? This will remove all database embeddings.')) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const headers = getAuthHeaders();
      const res = await fetch(getApiUrl(`/api/faces/${id}`), {
        method: 'DELETE',
        headers
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete profile');

      setSuccess('Face profile removed.');
      fetchFaces();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to delete profile');
    }
  };

  const getFaceImageUrl = (filename: string) => {
    return getApiUrl(`/uploads/faces/${filename}?token=${token}`);
  };

  return (
    <div className="flex-grow w-full max-w-7xl mx-auto px-6 py-6 flex flex-col lg:flex-row gap-6">
      
      {/* Registration Panel (Admin Only) */}
      <div className="w-full lg:w-96 flex-shrink-0 space-y-4">
        {userRole === 'admin' ? (
          <div className="bg-slate-900/30 border border-slate-850 p-6 rounded-2xl shadow-xl space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-100 uppercase tracking-tight flex items-center space-x-2">
                <UserPlus className="w-4.5 h-4.5 text-emerald-400" />
                <span>Register New Face</span>
              </h3>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Train NVR Identification Engine</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Person Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Description / Role</label>
                <textarea
                  placeholder="e.g. Family member, Delivery Agent"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={2}
                  className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none transition-colors resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Reference Photo</label>
                <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border border-dashed border-slate-800 rounded-xl bg-slate-950/50 hover:bg-slate-950 transition-colors">
                  <div className="space-y-1 text-center">
                    <Upload className="mx-auto h-8 w-8 text-slate-500" />
                    <div className="flex text-xs text-slate-400">
                      <label htmlFor="face-image-input" className="relative cursor-pointer rounded-md font-semibold text-emerald-400 hover:text-emerald-300">
                        <span>Upload reference image</span>
                        <input
                          id="face-image-input"
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={handleFileChange}
                        />
                      </label>
                    </div>
                    <p className="text-[10px] text-slate-600 uppercase font-bold">JPEG, JPG, PNG up to 5MB</p>
                  </div>
                </div>
                {imageFile && (
                  <p className="text-[10px] font-bold text-emerald-400 truncate mt-1">
                    Selected: {imageFile.name}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/10 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-slate-950/20 border-t-slate-950 rounded-full animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <span>Train Identity</span>
                )}
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-slate-900/30 border border-slate-850 p-6 rounded-2xl shadow-xl flex items-start space-x-3 text-xs text-slate-400">
            <ShieldAlert className="w-5 h-5 text-amber-500 flex-shrink-0" />
            <div>
              <p className="font-bold text-slate-300">Read-Only Mode</p>
              <p className="mt-1 text-[11px] leading-relaxed">
                Only NVR Administrators can upload profiles or modify the face directory.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Directory Content List */}
      <div className="flex-grow bg-slate-900/10 border border-slate-850 p-6 rounded-3xl shadow-xl flex flex-col min-h-0">
        <div>
          <h2 className="text-lg font-bold text-slate-200 uppercase tracking-tight flex items-center space-x-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <span>Face Identification Directory</span>
            <span className="text-xs bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full text-slate-400 font-bold">
              {faces.length} Profiles
            </span>
          </h2>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Known subjects catalog</p>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3.5 rounded-xl text-xs font-semibold mt-4">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3.5 rounded-xl text-xs font-semibold mt-4">
            {success}
          </div>
        )}

        {loading ? (
          <div className="flex-grow flex items-center justify-center py-24">
            <div className="w-8 h-8 border-3 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
          </div>
        ) : faces.length === 0 ? (
          <div className="flex-grow flex flex-col items-center justify-center py-24 text-center space-y-4">
            <div className="p-4 bg-slate-900/50 rounded-2xl text-slate-500 border border-slate-800">
              <Users className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-slate-300 text-sm font-semibold uppercase tracking-wider">Directory is Empty</h4>
              <p className="text-slate-500 text-xs max-w-sm mt-1">
                No face profiles registered yet. Use the upload panel on the left to train the first user profile.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 mt-6 overflow-y-auto max-h-[calc(100vh-260px)] pr-1 scrollbar-thin">
            {faces.map((face) => (
              <div
                key={face.id}
                className="bg-slate-900/40 border border-slate-850 p-4 rounded-2xl flex flex-col justify-between group hover:border-slate-800 transition-all relative overflow-hidden"
              >
                {/* Visual reference */}
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden bg-black border border-slate-800 flex-shrink-0">
                    <img
                      src={getFaceImageUrl(face.image_path)}
                      alt={face.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>

                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-200 text-sm truncate uppercase tracking-wide">{face.name}</h4>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{face.details || 'No details provided'}</p>
                    
                    {/* Training badge */}
                    <div className="mt-2.5 flex items-center">
                      {face.trained ? (
                        <span className="flex items-center space-x-1 text-[10px] font-bold text-emerald-400 uppercase">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Trained</span>
                        </span>
                      ) : (
                        <span className="flex items-center space-x-1 text-[10px] font-bold text-amber-400 uppercase animate-pulse">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Embedding...</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card footer details & Delete */}
                <div className="flex items-center justify-between border-t border-slate-850 mt-4 pt-3.5 text-[10px] text-slate-500 font-bold uppercase">
                  <span>Registered: {new Date(face.created_at).toLocaleDateString()}</span>
                  
                  {userRole === 'admin' && (
                    <button
                      onClick={() => handleDelete(face.id)}
                      className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-rose-500/5 transition-all"
                      title="Delete profile"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Info panel */}
        <div className="mt-6 flex items-start space-x-3.5 bg-slate-900/20 border border-slate-850 p-4 rounded-2xl text-[11px] leading-relaxed text-slate-400">
          <Info className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-slate-300">How Face Directory works:</span> After registering a profile, the Python AI container detects the change and encodes the face into a 128-dimension mathematical embedding vector directly in the database. Active camera analysis then performs real-time cosine similarity comparisons against these vectors to identify targets.
          </div>
        </div>

      </div>
    </div>
  );
}
