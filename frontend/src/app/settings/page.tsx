'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiUrl, getAuthHeaders } from '../../utils/api';
import { Settings, UserPlus, Trash2, Key, HardDrive, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface User {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [currentUserRole, setCurrentUserRole] = useState<string>('viewer');
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // Settings states
  const [segmentDuration, setSegmentDuration] = useState(300);
  const [retentionPeriod, setRetentionPeriod] = useState(7);
  const [storagePath, setStoragePath] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // User list states
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  // Add user states
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'viewer'>('viewer');
  const [userSuccess, setUserSuccess] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [userSaving, setUserSaving] = useState(false);

  // Change password states
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<User | null>(null);
  const [changePasswordVal, setChangePasswordVal] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const checkRoleAndInit = () => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (!token) {
      router.push('/login');
      return;
    }

    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setCurrentUserRole(user.role);
        setCurrentUserId(user.id);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(getApiUrl('/api/system/settings'), {
        headers: getAuthHeaders()
      });
      if (res.status === 401 || res.status === 450) {
        router.push('/login');
        return;
      }
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      setSegmentDuration(data.segment_duration);
      setRetentionPeriod(data.retention_period);
      setStoragePath(data.storage_path);
    } catch (err: any) {
      setSettingsError('Failed to fetch recording settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  const fetchUsers = async () => {
    if (currentUserRole !== 'admin') {
      setUsersLoading(false);
      return;
    }
    try {
      const res = await fetch(getApiUrl('/api/users'), {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      } else {
        throw new Error('Failed to load user list');
      }
    } catch (err: any) {
      setUsersError(err.message);
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    checkRoleAndInit();
  }, []);

  useEffect(() => {
    if (currentUserId !== null) {
      fetchSettings();
      fetchUsers();
    }
  }, [currentUserId, currentUserRole]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSuccess(false);
    setSettingsError(null);

    if (currentUserRole !== 'admin') return;

    try {
      const res = await fetch(getApiUrl('/api/system/settings'), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          segment_duration: segmentDuration,
          retention_period: retentionPeriod,
          storage_path: storagePath
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save settings');
      }

      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
    } catch (err: any) {
      setSettingsError(err.message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError(null);
    setUserSuccess(null);
    setUserSaving(true);

    try {
      const res = await fetch(getApiUrl('/api/users'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create user');
      }

      setUserSuccess(`User "${newUsername}" created successfully.`);
      setNewUsername('');
      setNewPassword('');
      setNewRole('viewer');
      fetchUsers();
    } catch (err: any) {
      setUserError(err.message);
    } finally {
      setUserSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForPassword) return;

    setPasswordError(null);
    setPasswordSuccess(false);
    setPasswordSaving(true);

    try {
      const res = await fetch(getApiUrl(`/api/users/${selectedUserForPassword.id}`), {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          password: changePasswordVal
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update password');
      }

      setPasswordSuccess(true);
      setChangePasswordVal('');
      setTimeout(() => {
        setSelectedUserForPassword(null);
        setPasswordSuccess(false);
      }, 2500);
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleDeleteUser = async (userToDelete: User) => {
    if (userToDelete.username === 'admin') {
      alert('Cannot delete the primary admin user.');
      return;
    }

    if (userToDelete.id === currentUserId) {
      alert('Cannot delete your own account while logged in.');
      return;
    }

    if (!confirm(`Are you sure you want to delete user "${userToDelete.username}"?`)) {
      return;
    }

    try {
      const res = await fetch(getApiUrl(`/api/users/${userToDelete.id}`), {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete user');
      }

      fetchUsers();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const isAdmin = currentUserRole === 'admin';

  return (
    <div className="flex-grow w-full max-w-7xl mx-auto px-6 py-6 space-y-6">
      {/* Read Only Warning Banner */}
      {!isAdmin && (
        <div className="flex items-center space-x-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 p-4 rounded-xl text-xs font-semibold">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 animate-bounce" />
          <span>Read-Only Mode: You are logged in as a Viewer. Changing recording parameters or user credentials requires an Administrator account.</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Panel: NVR Settings */}
        <div className="w-full lg:w-1/2 space-y-4">
          <div className="bg-slate-900/30 border border-slate-850 p-6 rounded-2xl shadow-xl space-y-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-100 uppercase flex items-center space-x-2">
                <Settings className="w-5.5 h-5.5 text-slate-400" />
                <span>NVR Settings</span>
              </h2>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Configure recording and storage metrics</p>
            </div>

            {settingsError && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3.5 rounded-xl text-xs font-semibold">
                {settingsError}
              </div>
            )}

            {settingsSuccess && (
              <div className="flex items-center space-x-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3.5 rounded-xl text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>System configuration updated successfully. Camera streams restarted.</span>
              </div>
            )}

            {settingsLoading ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
              </div>
            ) : (
              <form onSubmit={handleSaveSettings} className="space-y-4">
                {/* Storage Path */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                    <HardDrive className="w-4 h-4 text-slate-500" />
                    <span>NVR Storage Path</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={!isAdmin}
                    value={storagePath}
                    onChange={(e) => setStoragePath(e.target.value)}
                    className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-slate-300 placeholder-slate-650 focus:border-emerald-500 focus:outline-none transition-all disabled:opacity-50 font-mono"
                    placeholder="/mnt/hdd/recordings"
                  />
                  <p className="text-[10px] text-slate-500">
                    Directory where recorded segments are placed. Ensure Node process has write permission.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Segment Duration */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Segment Duration (sec)</label>
                    <input
                      type="number"
                      required
                      min={10}
                      max={3600}
                      disabled={!isAdmin}
                      value={segmentDuration}
                      onChange={(e) => setSegmentDuration(parseInt(e.target.value, 10))}
                      className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none transition-all disabled:opacity-50"
                    />
                    <p className="text-[9px] text-slate-500 leading-normal">
                      Target length of segment files. Default is 300 (5 min).
                    </p>
                  </div>

                  {/* Retention Period */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Retention Limit (days)</label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={365}
                      disabled={!isAdmin}
                      value={retentionPeriod}
                      onChange={(e) => setRetentionPeriod(parseInt(e.target.value, 10))}
                      className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs text-slate-300 focus:border-emerald-500 focus:outline-none transition-all disabled:opacity-50"
                    />
                    <p className="text-[9px] text-slate-500 leading-normal">
                      Days of history before files are auto-purged from storage.
                    </p>
                  </div>
                </div>

                {isAdmin && (
                  <button
                    type="submit"
                    className="w-full flex justify-center bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 active:from-emerald-700 active:to-teal-700 text-slate-950 px-4 py-3 rounded-xl text-xs font-bold tracking-wider uppercase transition-all shadow-md mt-2"
                  >
                    Update Recording Parameters
                  </button>
                )}
              </form>
            )}
          </div>
        </div>

        {/* Right Panel: User Control (Admin Only) */}
        {isAdmin && (
          <div className="w-full lg:w-1/2 space-y-6">
            {/* User List Panel */}
            <div className="bg-slate-900/30 border border-slate-850 p-6 rounded-2xl shadow-xl space-y-4">
              <div>
                <h3 className="text-md font-bold text-slate-100 uppercase tracking-tight flex items-center space-x-2">
                  <UserPlus className="w-5 h-5 text-slate-400" />
                  <span>Authorized Users</span>
                </h3>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Manage operator accounts and roles</p>
              </div>

              {usersError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-2.5 rounded-lg text-xs font-semibold">
                  {usersError}
                </div>
              )}

              {usersLoading ? (
                <div className="flex justify-center py-6">
                  <div className="w-5 h-5 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-850 hover:border-slate-800 rounded-xl transition-all"
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-slate-200">{user.username}</span>
                          <span className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            user.role === 'admin' 
                              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                              : 'bg-slate-800 border border-slate-700 text-slate-400'
                          }`}>
                            {user.role}
                          </span>
                        </div>
                        <span className="text-[9px] text-slate-550">Created: {new Date(user.created_at).toLocaleDateString()}</span>
                      </div>

                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => {
                            setSelectedUserForPassword(user);
                            setChangePasswordVal('');
                            setPasswordSuccess(false);
                            setPasswordError(null);
                          }}
                          className="p-2 text-slate-450 hover:text-emerald-400 hover:bg-slate-900 rounded-lg transition-colors"
                          title="Change Password"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </button>

                        {user.username !== 'admin' && user.id !== currentUserId && (
                          <button
                            onClick={() => handleDeleteUser(user)}
                            className="p-2 text-slate-450 hover:text-rose-400 hover:bg-slate-900 rounded-lg transition-colors"
                            title="Delete Account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Password Modal replacement card (shows up inline if a user is selected) */}
            {selectedUserForPassword && (
              <div className="bg-slate-900/40 border border-emerald-500/20 p-5 rounded-2xl shadow-xl space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider flex items-center space-x-1.5">
                      <Key className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Change Password: {selectedUserForPassword.username}</span>
                    </h4>
                  </div>
                  <button
                    onClick={() => setSelectedUserForPassword(null)}
                    className="text-xs text-slate-550 hover:text-slate-350"
                  >
                    Close
                  </button>
                </div>

                {passwordError && (
                  <div className="bg-rose-500/10 border border-rose-500/20 text-rose-450 p-2.5 rounded-lg text-xs font-medium">
                    {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-2.5 rounded-lg text-xs font-medium">
                    Password revised successfully.
                  </div>
                )}

                <form onSubmit={handleChangePassword} className="flex space-x-2">
                  <input
                    type="password"
                    required
                    value={changePasswordVal}
                    onChange={(e) => setChangePasswordVal(e.target.value)}
                    className="flex-grow rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-slate-300 placeholder-slate-650 focus:border-emerald-500 focus:outline-none transition-colors"
                    placeholder="New password (min 6 chars)"
                  />
                  <button
                    type="submit"
                    disabled={passwordSaving || changePasswordVal.length < 6}
                    className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-sm"
                  >
                    {passwordSaving ? 'Updating...' : 'Save'}
                  </button>
                </form>
              </div>
            )}

            {/* Create User Card */}
            <div className="bg-slate-900/30 border border-slate-850 p-6 rounded-2xl shadow-xl space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-tight">Create User Account</h3>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mt-0.5">Register a new dashboard operator</p>
              </div>

              {userError && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-450 p-3 rounded-lg text-xs font-semibold">
                  {userError}
                </div>
              )}

              {userSuccess && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-450 p-3 rounded-lg text-xs font-semibold">
                  {userSuccess}
                </div>
              )}

              <form onSubmit={handleCreateUser} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Username</label>
                    <input
                      type="text"
                      required
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-slate-350 placeholder-slate-650 focus:border-emerald-500 focus:outline-none transition-colors"
                      placeholder="e.g. operator1"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Password</label>
                    <input
                      type="password"
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-slate-350 placeholder-slate-650 focus:border-emerald-500 focus:outline-none transition-colors"
                      placeholder="min 6 chars"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assign Authorization Role</label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as 'admin' | 'viewer')}
                    className="block w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-slate-350 focus:border-emerald-500 focus:outline-none transition-colors"
                  >
                    <option value="viewer">Viewer (Read-only live & playback)</option>
                    <option value="admin">Admin (Full write configurations & user settings)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={userSaving || newUsername.length < 3 || newPassword.length < 6}
                  className="w-full flex justify-center bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 disabled:opacity-50 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shadow-md mt-1"
                >
                  {userSaving ? 'Creating Account...' : 'Register Operator'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
