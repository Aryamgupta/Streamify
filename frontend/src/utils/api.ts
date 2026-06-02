export function getApiUrl(path: string): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // Serve from the same host, port 5000
    return `http://${hostname}:5000${path}`;
  }
  return `http://localhost:5000${path}`;
}

export function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };
}
