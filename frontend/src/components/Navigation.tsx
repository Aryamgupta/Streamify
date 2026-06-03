'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutGrid, Film, Camera, Settings, LogOut, ShieldAlert, Users, Activity } from 'lucide-react';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [username, setUsername] = useState<string>('');
  const [role, setRole] = useState<string>('');

  useEffect(() => {
    // Check authentication
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');

    if (!token) {
      router.push('/login');
      return;
    }

    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setUsername(user.username);
        setRole(user.role);
      } catch (err) {
        console.error(err);
      }
    }
  }, [pathname, router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  // Do not show navigation on login screen
  if (pathname === '/login') return null;

  const navItems = [
    { name: 'Dashboard', href: '/', icon: LayoutGrid },
    { name: 'Recordings', href: '/recordings', icon: Film },
    { name: 'Cameras', href: '/cameras', icon: Camera },
    { name: 'Face Directory', href: '/faces', icon: Users },
    { name: 'Activity Logs', href: '/logs', icon: Activity },
    { name: 'Settings & Users', href: '/settings', icon: Settings }
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-6 max-w-7xl mx-auto">
        {/* Brand logo */}
        <div className="flex items-center space-x-2.5">
          <div className="bg-gradient-to-tr from-emerald-500 to-teal-400 p-2 rounded-lg text-slate-950 shadow-md shadow-emerald-500/10">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-slate-100 text-sm tracking-wide uppercase leading-none">Streamify</h1>
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-widest leading-none">NVR NVR</span>
          </div>
        </div>

        {/* Desktop nav links */}
        <nav className="hidden md:flex space-x-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all border ${
                  isActive
                    ? 'bg-slate-900 border-slate-800 text-emerald-400 shadow-sm'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* User profile & logout */}
        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-semibold text-slate-200">{username}</span>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-end space-x-1">
              {role === 'admin' && <ShieldAlert className="w-3 h-3 text-emerald-500" />}
              <span>{role}</span>
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center justify-center p-2 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900/40 text-slate-400 hover:text-rose-400 hover:bg-rose-500/5 transition-all shadow-md group"
            title="Log Out"
          >
            <LogOut className="w-4.5 h-4.5 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      </div>
    </header>
  );
}
