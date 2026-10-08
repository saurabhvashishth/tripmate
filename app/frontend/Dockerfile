FROM nginx:1.27-alpine

# Replace default site config with our reverse-proxy + SPA config
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static assets (keycloak.min.js is vendored to avoid a runtime CDN dependency)
COPY index.html style.css app.js config.js auth.js keycloak.min.js /usr/share/nginx/html/

EXPOSE 80
