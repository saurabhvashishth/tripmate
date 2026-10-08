// ============================================================================
// TripMate auth shim — OIDC login gate via Keycloak (keycloak-js from CDN).
//
// Exposes window.TripAuth:
//   TripAuth.enabled        -> boolean
//   TripAuth.init()         -> Promise<boolean> (true once ready/authenticated)
//   TripAuth.token()        -> Promise<string|null> (fresh bearer token)
//   TripAuth.user()         -> { name, email } | null
//   TripAuth.logout()
//
// When AUTH_ENABLED is false, init() resolves immediately and the app runs
// exactly as before (no login). This keeps the demo flexible.
// ============================================================================
(function () {
  const cfg = window.TRIPMATE_CONFIG || {};
  let kc = null;

  const TripAuth = {
    enabled: !!cfg.AUTH_ENABLED,

    async init() {
      if (!this.enabled) return true;

      // Vendored into the image (see Dockerfile) so there's no external CDN
      // dependency at runtime — more reliable on locked-down networks.
      await loadScript("/keycloak.min.js");

      kc = new Keycloak({
        url: cfg.KEYCLOAK_URL,
        realm: cfg.KEYCLOAK_REALM,
        clientId: cfg.KEYCLOAK_CLIENT_ID,
      });

      const authenticated = await kc.init({
        onLoad: "login-required",
        pkceMethod: "S256",
        checkLoginIframe: false,
      });

      if (authenticated) {
        // Refresh the token in the background before it expires.
        setInterval(() => kc.updateToken(60).catch(() => kc.login()), 30000);
      }
      return authenticated;
    },

    async token() {
      if (!this.enabled || !kc) return null;
      try {
        await kc.updateToken(30);
      } catch (_) {
        /* will be refreshed on next call */
      }
      return kc.token || null;
    },

    user() {
      if (!this.enabled || !kc || !kc.tokenParsed) return null;
      const t = kc.tokenParsed;
      return {
        name: t.name || t.preferred_username || "User",
        email: t.email || "",
      };
    },

    logout() {
      if (kc) kc.logout({ redirectUri: window.location.origin });
    },
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("failed to load " + src));
      document.head.appendChild(s);
    });
  }

  window.TripAuth = TripAuth;
})();
