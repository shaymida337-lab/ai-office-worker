const getGoogleRedirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI ||
  process.env.GOOGLE_CALLBACK_URL ||
  'https://ai-office-worker-backend.onrender.com/api/auth/google/callback';

const getClientGmailRedirectUri = () =>
  process.env.GOOGLE_CLIENT_REDIRECT_URI ||
  process.env.GOOGLE_CALLBACK_URL?.replace('/api/auth/google/callback', '/api/clients/gmail/callback') ||
  'https://ai-office-worker-backend.onrender.com/api/clients/gmail/callback';

module.exports = { getGoogleRedirectUri, getClientGmailRedirectUri };
