# TripMate 🧭

A lightweight, Splitwise-style microservices app for groups and trips: track multiple trips,
split expenses (equally, by unequal amounts, or by percentage), record settlement payments,
see running per-member balances within a trip and across all trips, get a simplified
"who-pays-whom" settle-up plan, and share trip photos. **No account or login required.**
Runs on your existing EKS cluster. Container images are hosted on **GitHub Container Registry
(GHCR, public)**, so no ECR is needed.

### Features
- Multiple persistent trips, each with its own members, currency, and emoji
- Expense categories (food, transport, stay, …) with a chronological activity feed
- Equal / unequal / percentage splits with live validation
- Record real settlement payments; balances update accordingly
- Smart debt simplification (minimises the number of transfers)
- Overall cross-trip balances in the sidebar
- Shareable trip links (`/#<tripId>`) — no sign-in
- Photo gallery per trip (S3-backed)

## Architecture

```
                          ┌───────────────── AWS ALB (Ingress) ─────────────────┐
                          │                                                      │
  browser ──────────────▶│  frontend (nginx)  ── reverse-proxies /api/* ───┐    │
                          └──────────────────────────────────────────────────┘  │
                                                                             │
        ┌────────────────────────────────────────────────────────────────────┘
        │
        ├── /api/trips                         ─▶ trip-service    (Node/Express + SQLite)
        ├── /api/expenses /payments /balances  ─▶ expense-service (Node/Express + SQLite)
        │   /activity                              split calc, settlements, cross-trip balances
        └── /api/photos                        ─▶ photo-service   (Node/Express + S3 via IRSA)
```

| Service          | Tech                       | Storage           |
|------------------|----------------------------|-------------------|
| frontend         | static HTML/JS + nginx     | –                 |
| trip-service     | Node 20 / Express          | SQLite (EBS PVC)  |
| expense-service  | Node 20 / Express          | SQLite (EBS PVC)  |
| photo-service    | Node 20 / Express, AWS SDK | S3 (IRSA)         |

> **Note on storage:** SQLite persists on `gp3` EBS volumes via PersistentVolumeClaims, so
> trip/expense data survives pod restarts and rollouts. This requires the **EBS CSI driver**
> (installed as an EKS addon by Terraform) and the `gp3` StorageClass in `k8s/05-storageclass.yaml`.
> Each of these services is a single replica using a `ReadWriteOnce` volume with the `Recreate`
> rollout strategy. Photos are durable — they live in S3.

## Repository layout

```
app/
  trip-service/      # Dockerfile + server.js
  expense-service/
  photo-service/
  frontend/
k8s/                 # Kubernetes manifests (namespace, deployments, services, ingress)
terraform-infra/     # Terraform: existing VPC/EKS + tripmate.tf (S3, IRSA, ALB IAM)
```

## Prerequisites

- `aws` CLI configured for account/profile used in `terraform-infra/variables.tf`
- `kubectl`, `helm`, `docker`
- A GitHub Personal Access Token (PAT) with `write:packages` scope

---

## 1. Provision app infrastructure (Terraform)

This adds an S3 bucket, the IAM OIDC provider (IRSA), the photo-service role, the
AWS Load Balancer Controller IAM policy/role, and the **EBS CSI driver** (EKS addon +
its IRSA role) for durable SQLite storage. It reuses your existing EKS cluster.

```powershell
cd terraform-infra
terraform init
terraform apply
```

Capture the outputs — you'll need them below:

```powershell
terraform output photo_bucket
terraform output photo_irsa_role_arn
terraform output alb_controller_role_arn
```

## 2. Point kubectl at the cluster

```powershell
aws eks update-kubeconfig --name main-eks-cluster --region ap-south-1 --profile <your-profile>
kubectl get nodes
```

## 3. Build and push images to GHCR (public)

Log in to GHCR with your PAT (username = `saurabhvashishth`):

```powershell
$env:CR_PAT = "<your-github-PAT>"
$env:CR_PAT | docker login ghcr.io -u saurabhvashishth --password-stdin
```

Build and push each image:

```powershell
$OWNER = "saurabhvashishth"

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
> ```powershell
> kubectl -n tripmate create secret docker-registry ghcr-pull `
>   --docker-server=ghcr.io --docker-username=saurabhvashishth --docker-password=$env:CR_PAT
> ```

## 4. Install the AWS Load Balancer Controller

The Ingress needs this controller to provision the ALB. Install it via Helm, using the
IRSA role ARN from Terraform.

```powershell
helm repo add eks https://aws.github.io/eks-charts
helm repo update

$VPC_ID = "vpc-0134e102a4dc91bff"
$ROLE_ARN = terraform -chdir=terraform-infra output -raw alb_controller_role_arn

helm install aws-load-balancer-controller eks/aws-load-balancer-controller `
  -n kube-system `
  --set clusterName=main-eks-cluster `
  --set region=ap-south-1 `
  --set vpcId=$VPC_ID `
  --set serviceAccount.create=true `
  --set serviceAccount.name=aws-load-balancer-controller `
  --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=$ROLE_ARN"

kubectl -n kube-system rollout status deploy/aws-load-balancer-controller
```

> The public subnets used by the ALB must be tagged `kubernetes.io/role/elb = 1` and
> `kubernetes.io/cluster/main-eks-cluster = shared|owned` for the controller to discover them.

## 5. Deploy the app

The namespace/deployments are plain YAML. The photo-service manifest has two placeholders
(`${PHOTO_SA_ROLE_ARN}`, `${PHOTO_BUCKET}`) filled from Terraform outputs.

```powershell
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/05-storageclass.yaml
kubectl apply -f k8s/10-trip-service.yaml
kubectl apply -f k8s/11-expense-service.yaml
kubectl apply -f k8s/13-frontend.yaml
kubectl apply -f k8s/20-ingress.yaml

# photo-service: substitute placeholders, then apply
$env:PHOTO_SA_ROLE_ARN = terraform -chdir=terraform-infra output -raw photo_irsa_role_arn
$env:PHOTO_BUCKET       = terraform -chdir=terraform-infra output -raw photo_bucket

(Get-Content k8s/12-photo-service.yaml) `
  -replace '\$\{PHOTO_SA_ROLE_ARN\}', $env:PHOTO_SA_ROLE_ARN `
  -replace '\$\{PHOTO_BUCKET\}', $env:PHOTO_BUCKET |
  kubectl apply -f -
```

## 6. Get the app URL

```powershell
kubectl -n tripmate get ingress tripmate
```

Wait for the `ADDRESS` column to show the ALB DNS name (takes a minute or two), then open it
in a browser: `http://<alb-dns-name>/`.

---

## Local development

Each service runs standalone with Node 20:

```powershell
cd app/trip-service; npm install; $env:DB_PATH="./trips.db"; npm start   # :3000
```

The photo-service needs `PHOTO_BUCKET` set and AWS credentials in the environment.

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

```powershell
kubectl delete -f k8s/ --ignore-not-found
helm uninstall aws-load-balancer-controller -n kube-system
cd terraform-infra; terraform destroy   # removes S3 bucket (force_destroy) + IAM
```
