import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
  timeout: 30000,
});

// Attach JWT token automatically
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('ai_office_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 - logout
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('ai_office_token');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export const apiClient = {
  // Auth
  getMe: () => api.get('/api/auth/me'),
  logout: () => api.post('/api/auth/logout'),
  login: (email, password, whatsappNumber) => api.post('/api/auth/login', { email, password, whatsappNumber }),
  getGoogleAuthStatus: () => api.get('/api/auth/google/status'),

  // Dashboard
  getStats: () => api.get('/api/dashboard/stats'),

  // Documents
  getDocuments: (params) => api.get('/api/documents', { params }),
  getDocument: (id) => api.get(`/api/documents/${id}`),
  updateDocumentStatus: (id, status) => api.patch(`/api/documents/${id}/status`, { status }),
  updateDocument: (id, data) => api.patch(`/api/documents/${id}`, data),

  // Scan
  triggerScan: () => api.post('/api/scan/now'),
  getLogs: () => api.get('/api/scan/logs'),

  // Settings
  getSettings: () => api.get('/api/settings'),
  saveSheetSettings: (data) => api.put('/api/settings/sheets', data),
  testSheetConnection: (sheetUrl, type) => api.post('/api/settings/sheets/test', { sheetUrl, type }),
  testDriveFolder: (driveFolderUrl) => api.post('/api/settings/drive/test', { driveFolderUrl }),
  
  // Demo
  getDemo: () => api.get('/api/demo/live'),

  // Payments
  getPayments: (params) => api.get('/api/payments', { params }),
  getSuppliers: () => api.get('/api/payments/suppliers'),
  markPaymentPaid: (id, paid) => api.patch(`/api/payments/${id}/paid`, { paid }),
  getMissingInvoices: () => api.get('/api/payments/missing-invoices'),
};
