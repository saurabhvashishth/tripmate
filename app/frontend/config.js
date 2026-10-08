// Runtime configuration for TripMate auth.
// Edit these values to point at your Keycloak instance, then redeploy the
// frontend (or patch the ConfigMap). No rebuild of app.js is required.
//
// AUTH_ENABLED=false keeps the app open (original no-login behaviour).
// Set it to true and fill in the Keycloak URL to turn on the login gate.
window.TRIPMATE_CONFIG = {
  AUTH_ENABLED: false,
  KEYCLOAK_URL: "http://REPLACE-WITH-KEYCLOAK-ALB-HOST",
  KEYCLOAK_REALM: "tripmate",
  KEYCLOAK_CLIENT_ID: "tripmate-web",
};
