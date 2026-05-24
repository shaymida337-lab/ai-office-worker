const getGoogleRedirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI ||
  process.env.GOOGLE_CALLBACK_URL ||
  'https://ai-office-worker-backend.onrender.com/api/auth/google/callback';

module.exports = { getGoogleRedirectUri };
