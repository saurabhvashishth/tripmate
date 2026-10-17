# TripMate 🧭

A lightweight, Splitwise-style microservices app for groups and trips: track multiple trips,
split expenses (equally, by unequal amounts, or by percentage), record settlement payments,
see running per-member balances within a trip and across all trips, get a simplified
"who-pays-whom" settle-up plan, and share trip photos. **No account or login required.**
Runs on any in-house / on-prem Kubernetes cluster — no cloud dependencies. Durable storage
uses an **NFS** StorageClass, photos live in a self-hosted **MinIO** (S3-compatible) object
store, and traffic is routed by the **NGINX Ingress Controller**. Container images are hosted
on **GitHub Container Registry (GHCR, public)**.

### Features
- Multiple persistent trips, each with its own members, currency, and emoji
- Expense categories (food, transport, stay, …) with a chronological activity feed
- Equal / unequal / percentage splits with live validation
- Record real settlement payments; balances update accordingly
- Smart debt simplification (minimises the number of transfers)
- Overall cross-trip balances in the sidebar
- Add, **edit** (description/amount/category) and delete expenses
- Shareable trip links (`/#<tripId>`) — no sign-in
- Photo gallery per trip (MinIO-backed) — upload, view and **delete**

## Architecture

```
                       ┌──────────── NGINX Ingress Controller ───────────┐
                       │  tripmate.local        minio.tripmate.local      │
  browser ────────────▶│      │                       │                   │
                       └──────┼───────────────────────┼───────────────────┘
                              │                        │ (presigned photo GETs)
                              ▼                        ▼
                     frontend (nginx) ── /api/* ─┐   MinIO (S3-compatible)
                              │                   │        ▲
        ┌─────────────────────────────────────────┘        │ photo bytes
        │                                                   │
        ├── /api/trips                         ─▶ trip-service    (Node/Express + SQLite)
        ├── /api/expenses /payments /balances  ─▶ expense-service (Node/Express + SQLite)
        │   /activity                              split calc, settlements, cross-trip balances
        └── /api/photos                        ─▶ photo-service   (Node/Express + MinIO)
```

| Service          | Tech                       | Storage              |
|------------------|----------------------------|----------------------|
| frontend         | static HTML/JS + nginx     | –                    |
| trip-service     | Node 20 / Express          | SQLite (NFS PVC)     |
| expense-service  | Node 20 / Express          | SQLite (NFS PVC)     |
| photo-service    | Node 20 / Express, AWS SDK | MinIO (S3-compatible)|

> **Note on storage:** SQLite persists on **NFS** volumes via PersistentVolumeClaims, so
> trip/expense data survives pod restarts and rollouts. The PVCs use a dedicated
> **`tripmate-nfs`** StorageClass (`k8s/05-storageclass.yaml`) that drives the cluster's NFS
> CSI driver (`nfs.csi.k8s.io`, export `172.16.11.78:/data`) and groups this app's volumes
> under `/data/tripmate/`. Each of these services is a single replica (SQLite is single-writer)
> with the `Recreate` rollout strategy. Photos are durable — they live in **MinIO**, a
> self-hosted S3-compatible object store (`k8s/06-minio.yaml`) that itself persists on an NFS PVC.

## Repository layout

```
app/
  trip-service/      # Dockerfile + server.js
  expense-service/
  photo-service/
  frontend/
k8s/                 # Kubernetes manifests (namespace, storage, MinIO, deployments, ingress)
```

> The `terraform-infra/` directory is only needed for the AWS/EKS deployment (see the
> `main` branch). It is not used by this in-house deployment.

## Prerequisites

> All commands below are written for the **Linux** control node (bash). Run them from a shell
> on the cluster's master/control node (or any machine with `kubectl` access to it).

- An in-house Kubernetes cluster you can reach with `kubectl`
- `kubectl`, `helm`, `docker`
- The **NFS CSI driver** (`nfs.csi.k8s.io`) installed in the cluster (see step 1). The app's
  own `tripmate-nfs` StorageClass (`k8s/05-storageclass.yaml`) drives it against
  `172.16.11.78:/data`.
- The **NGINX Ingress Controller** installed in the cluster
- A GitHub Personal Access Token (PAT) with `write:packages` scope (only to push images)

---

## 1. Install the NFS CSI driver

Durable storage is backed by the NFS export `172.16.11.78:/data` via the Kubernetes NFS CSI
driver. Install it once (cluster-wide):

```bash
helm repo add csi-driver-nfs https://raw.githubusercontent.com/kubernetes-csi/csi-driver-nfs/master/charts
helm repo update
helm install csi-driver-nfs csi-driver-nfs/csi-driver-nfs -n kube-system --version v4.9.0

kubectl -n kube-system rollout status daemonset/csi-nfs-node
kubectl get csidrivers | grep nfs.csi.k8s.io
```

The app ships its own StorageClass, `tripmate-nfs` (applied in step 5 as
`k8s/05-storageclass.yaml`), which uses this driver and groups all app volumes under
`/data/tripmate/` on the NFS export. The CSI driver creates those subdirectories
automatically — no manual `mkdir` on the NFS server is needed.

## 2. Install the NGINX Ingress Controller

This is a bare-metal cluster with no cloud LoadBalancer, so the controller is exposed via
**NodePort** (HTTP on `30080`, HTTPS on `30443`). If it is not already installed:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace \
  --set controller.service.type=NodePort \
  --set controller.service.nodePorts.http=30080 \
  --set controller.service.nodePorts.https=30443

kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller
kubectl -n ingress-nginx get svc ingress-nginx-controller
```

The app is reached on **any node IP at port 30080** (e.g. `172.30.41.248:30080`). Because the
ingress routes by hostname, point your DNS (or `/etc/hosts`) for both `tripmate.local` and
`minio.tripmate.local` at a node IP:

```
172.30.41.248   tripmate.local
172.30.41.248   minio.tripmate.local
```

## 3. Build and push images to GHCR (public)

Log in to GHCR with your PAT (username = `saurabhvashishth`):

```bash
export CR_PAT="<your-github-PAT>"
echo "$CR_PAT" | docker login ghcr.io -u saurabhvashishth --password-stdin
```

Build and push each image:

```bash
OWNER="saurabhvashishth"

docker build -t ghcr.io/$OWNER/tripmate-trip-service:latest    app/trip-service
docker build -t ghcr.io/$OWNER/tripmate-expense-service:latest app/expense-service
docker build -t ghcr.io/$OWNER/tripmate-photo-service:latest   app/photo-service
docker build -t ghcr.io/$OWNER/tripmate-frontend:latest        app/frontend

docker push ghcr.io/$OWNER/tripmate-trip-service:latest
docker push ghcr.io/$OWNER/tripmate-expense-service:latest
docker push ghcr.io/$OWNER/tripmate-photo-service:latest
docker push ghcr.io/$OWNER/tripmate-frontend:latest
```

After the first push, open each package in GitHub → **Package settings** → **Change visibility** →
**Public**. Public packages need no pull secret in the cluster.

> **If you'd rather keep them private:** create a pull secret and add
> `imagePullSecrets` to each Deployment:
> ```bash
> kubectl -n tripmate create secret docker-registry ghcr-pull \
>   --docker-server=ghcr.io --docker-username=saurabhvashishth --docker-password="$CR_PAT"
> ```

## 4. Set the MinIO credentials

Photos are stored in MinIO. Edit `k8s/06-minio.yaml` and change the `minio-credentials`
Secret (`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) from the defaults. The photo-service reads
the same Secret for its S3 access keys, so you only set them in one place.

If you expose MinIO under a different hostname than `minio.tripmate.local`, also update the
`S3_PUBLIC_ENDPOINT` env in `k8s/12-photo-service.yaml` and the `minio-s3` host in
`k8s/20-ingress.yaml` to match.

> **Why `S3_PUBLIC_ENDPOINT` includes `:30080`.** The photo-service signs photo view URLs
> against this host, and the browser fetches them directly. Since the ingress is a NodePort on
> `30080`, the value is `http://minio.tripmate.local:30080` — it must match how the browser
> actually reaches MinIO, or the presigned-URL signature breaks. If you later move to a `:80`
> LoadBalancer (e.g. MetalLB), change it back to `http://minio.tripmate.local`.

> **Note on MinIO storage/credentials.** MinIO stores its root identity in its data volume on
> first startup, so changing the Secret after it has initialised won't rotate the keys. If the
> photo-service logs `InvalidAccessKeyId`, give MinIO a fresh volume: scale it to 0, delete the
> `minio-data` PVC, and re-apply `k8s/06-minio.yaml`. The `alpine/minio` image runs as a
> non-root user, so the deployment sets `securityContext.fsGroup: 1000` to get write access to
> the NFS-backed volume.

### Authentication (Keycloak) — off by default

The frontend image can enforce Keycloak login, but the in-house deployment ships it **off**.
`k8s/13-frontend.yaml` mounts a `frontend-config` ConfigMap that overrides the image's
`config.js` with `AUTH_ENABLED: false`. To enable auth, deploy a Keycloak (see the
`feature/keycloak-auth` branch), then set `AUTH_ENABLED: true` and a reachable `KEYCLOAK_URL`
in that ConfigMap and restart the frontend.

## 5. Deploy the app

All manifests are plain YAML — no placeholder substitution needed. Apply them in order:

```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/05-storageclass.yaml
kubectl apply -f k8s/06-minio.yaml
kubectl apply -f k8s/10-trip-service.yaml
kubectl apply -f k8s/11-expense-service.yaml
kubectl apply -f k8s/12-photo-service.yaml
kubectl apply -f k8s/13-frontend.yaml
kubectl apply -f k8s/20-ingress.yaml

kubectl -n tripmate rollout status deploy/minio
kubectl -n tripmate get pods
```

The photo-service auto-creates the `tripmate-photos` bucket in MinIO on startup.

## 6. Get the app URL

```bash
kubectl -n tripmate get ingress
```

With the `/etc/hosts` entries from step 2 in place (both `tripmate.local` and
`minio.tripmate.local` → a node IP), open the app in a browser at:
**`http://tripmate.local:30080/`**

Both hostnames must resolve: `tripmate.local` serves the app, and `minio.tripmate.local`
serves photo images via presigned URLs.

---

## Local development

Each service runs standalone with Node 20:

```bash
cd app/trip-service && npm install && DB_PATH="./trips.db" npm start   # :3000
```

The photo-service needs `PHOTO_BUCKET` set plus S3 connection details. For local MinIO:

```bash
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=tripmate -e MINIO_ROOT_PASSWORD=changeme-tripmate-minio \
  alpine/minio:latest-release server /data --console-address ":9001"

cd app/photo-service && npm install
export PHOTO_BUCKET="tripmate-photos"
export S3_ENDPOINT="http://localhost:9000"
export S3_FORCE_PATH_STYLE="true"
export AWS_ACCESS_KEY_ID="tripmate"
export AWS_SECRET_ACCESS_KEY="changeme-tripmate-minio"
npm start   # :3000
```

## API quick reference

| Method | Path                                  | Purpose                                   |
|--------|---------------------------------------|-------------------------------------------|
| POST   | `/api/trips`                          | create trip (optional `members[]` seed)   |
| GET    | `/api/trips`                          | list trips (with members)                 |
| GET    | `/api/trips/:id`                      | get one trip                              |
| PATCH  | `/api/trips/:id`                      | update trip (name, emoji, currency, …)    |
| DELETE | `/api/trips/:id`                      | delete trip                               |
| POST   | `/api/trips/:id/members`              | add member                                |
| DELETE | `/api/trips/:id/members/:memberId`    | remove member                             |
| GET    | `/api/expenses/categories`            | list expense categories                   |
| POST   | `/api/expenses`                       | add expense (equal / unequal / percent)   |
| GET    | `/api/expenses/:tripId`               | list expenses for a trip                  |
| PATCH  | `/api/expenses/item/:id`              | edit an expense                           |
| DELETE | `/api/expenses/item/:id`              | delete an expense                         |
| GET    | `/api/expenses/:tripId/summary`       | balances, settlements, spend-by-category  |
| POST   | `/api/payments`                       | record a settlement payment               |
| GET    | `/api/payments/:tripId`               | list settlement payments                  |
| DELETE | `/api/payments/item/:id`              | remove a payment                          |
| GET    | `/api/activity/:tripId`               | merged expense + payment feed             |
| GET    | `/api/balances`                       | cross-trip running balances + settle plan |
| POST   | `/api/photos/:tripId` (multipart)     | upload photo                              |
| GET    | `/api/photos/:tripId`                 | list photos (presigned URLs)              |

## Teardown

```bash
kubectl delete -f k8s/ --ignore-not-found
# Optional: remove the ingress controller / CSI driver if nothing else uses them
helm uninstall ingress-nginx -n ingress-nginx
# helm uninstall csi-driver-nfs -n kube-system   # only if no other app uses NFS
```

> The `tripmate-nfs` StorageClass uses `reclaimPolicy: Retain`, so the volume directories
> under `/data/tripmate/` on `172.16.11.78` are kept after `kubectl delete`. Remove them
> manually on the NFS server if you want to reclaim space.
