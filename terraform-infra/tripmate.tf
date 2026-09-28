# =============================================================================
# TripMate application infrastructure
#   - S3 bucket for trip photos
#   - IAM OIDC provider for the EKS cluster (enables IRSA)
#   - IRSA role for the photo-service (scoped S3 access)
#   - IRSA role + IAM policy for the AWS Load Balancer Controller
#
# Container images are hosted on GHCR (public), so no ECR is required.
# =============================================================================

data "aws_caller_identity" "current" {}

locals {
  photo_bucket_name = "tripmate-photos-${data.aws_caller_identity.current.account_id}"
  oidc_issuer       = aws_eks_cluster.main.identity[0].oidc[0].issuer
  # host portion of the OIDC issuer URL, e.g. oidc.eks.ap-south-1.amazonaws.com/id/ABC123
  oidc_host = replace(local.oidc_issuer, "https://", "")
}

# ─── S3 bucket for photos ────────────────────────────────────────────────────
resource "aws_s3_bucket" "photos" {
  bucket        = local.photo_bucket_name
  force_destroy = true
  tags          = { Name = "tripmate-photos", app = "tripmate" }
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket                  = aws_s3_bucket.photos.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["*"]
    max_age_seconds = 3000
  }
}

# ─── OIDC provider for IRSA ──────────────────────────────────────────────────
data "tls_certificate" "eks_oidc" {
  url = local.oidc_issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  url             = local.oidc_issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks_oidc.certificates[0].sha1_fingerprint]
}

# ─── IRSA role: photo-service (S3 access) ────────────────────────────────────
data "aws_iam_policy_document" "photo_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.eks.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["system:serviceaccount:tripmate:photo-service"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "photo_service" {
  name               = "tripmate-photo-service"
  assume_role_policy = data.aws_iam_policy_document.photo_assume.json
}

data "aws_iam_policy_document" "photo_s3" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.photos.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.photos.arn]
  }
}

resource "aws_iam_role_policy" "photo_s3" {
  name   = "tripmate-photo-s3"
  role   = aws_iam_role.photo_service.id
  policy = data.aws_iam_policy_document.photo_s3.json
}

# ─── AWS Load Balancer Controller: IAM policy + IRSA role ────────────────────
resource "aws_iam_policy" "alb_controller" {
  name        = "AWSLoadBalancerControllerIAMPolicy-tripmate"
  description = "Policy for the AWS Load Balancer Controller (TripMate)"
  policy      = file("${path.module}/alb-iam-policy.json")
}

data "aws_iam_policy_document" "alb_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.eks.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  name               = "tripmate-alb-controller"
  assume_role_policy = data.aws_iam_policy_document.alb_assume.json
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  role       = aws_iam_role.alb_controller.name
  policy_arn = aws_iam_policy.alb_controller.arn
}

# ─── Outputs consumed by the k8s manifests / helm install ────────────────────
output "photo_bucket" {
  description = "S3 bucket name for TripMate photos"
  value       = aws_s3_bucket.photos.bucket
}

output "photo_irsa_role_arn" {
  description = "IRSA role ARN to annotate the photo-service ServiceAccount"
  value       = aws_iam_role.photo_service.arn
}

output "alb_controller_role_arn" {
  description = "IRSA role ARN for the AWS Load Balancer Controller service account"
  value       = aws_iam_role.alb_controller.arn
}
