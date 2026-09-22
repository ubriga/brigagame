// Brigagame 2.0 by OrelAI - frontend configuration.
// After deploying the backend to PythonAnywhere, set API_BASE to its URL,
// e.g. "https://<username>.pythonanywhere.com"
const CONFIG = {
  // Client deploy version. Must match the backend SERVER_VERSION; when the
  // presence pulse reports a different version the app reloads itself in the
  // lobby (never mid-game) to pick up the new build.
  CLIENT_VERSION: "22",
  API_BASE: "https://ubriga.pythonanywhere.com",
  // Google OAuth Web Client ID (same value as the backend GOOGLE_CLIENT_ID).
  GOOGLE_CLIENT_ID: "609382927099-k7b75i2igf0ka0t0ohknfa6svlcp5s29.apps.googleusercontent.com",
  // Adaptive match-state polling: hot right after activity, backs off when
  // idle so the free tier is not hammered. Hidden tabs poll rarely.
  POLL_MIN_MS: 800,
  POLL_MAX_MS: 2600,
  POLL_HIDDEN_MS: 5000,
  // App-wide presence pulse: keeps the player invitable from any screen and
  // delivers incoming match invites.
  PRESENCE_PULSE_MS: 8000,
};
