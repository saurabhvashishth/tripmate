const express = require("express");
const cors = require("cors");
const multer = require("multer");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const PORT = process.env.PORT || 3000;
const REGION = process.env.AWS_REGION || "us-east-1";
const BUCKET = process.env.PHOTO_BUCKET; // required
const URL_TTL = Number(process.env.PRESIGN_TTL || 3600);

// S3-compatible endpoint. For in-house deployments this points at MinIO
// (e.g. http://minio.tripmate.svc.cluster.local:9000). Left unset means the
// SDK talks to real AWS S3.
const S3_ENDPOINT = process.env.S3_ENDPOINT || "";
// MinIO (and most self-hosted S3) require path-style addressing rather than
// virtual-hosted-style (bucket.endpoint). Defaults on when an endpoint is set.
const FORCE_PATH_STYLE =
  (process.env.S3_FORCE_PATH_STYLE || (S3_ENDPOINT ? "true" : "false")) === "true";

if (!BUCKET) {
  console.error("PHOTO_BUCKET env var is required");
  process.exit(1);
}

const s3 = new S3Client({
  region: REGION,
  // When talking to MinIO we pass an explicit endpoint + path-style. When
  // these are empty/false the client behaves exactly as before against S3.
  ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
  forcePathStyle: FORCE_PATH_STYLE,
  // Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in the
  // environment (a Kubernetes Secret for MinIO), or the default AWS chain.
});

// Ensure the target bucket exists. On MinIO the bucket may not be pre-created;
// this is a no-op when it already exists. Harmless against S3 too (the caller
// just needs CreateBucket perms, otherwise it is ignored).
async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      console.log(`created bucket ${BUCKET}`);
    } catch (err) {
      console.warn(`could not ensure bucket ${BUCKET}: ${err.name || err}`);
    }
  }
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "photo-service" }));

// Upload a photo for a trip: multipart/form-data, field name "photo"
app.post("/api/photos/:tripId", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "photo file is required" });
    const tripId = req.params.tripId;
    const ext = (req.file.originalname.split(".").pop() || "bin").toLowerCase();
    const key = `${tripId}/${uid()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        Metadata: {
          caption: encodeURIComponent(req.body.caption || ""),
          uploaded_by: encodeURIComponent(req.body.uploaded_by || ""),
        },
      })
    );

    res.status(201).json({ key, url: await presign(key) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "upload failed" });
  }
});

// List photos for a trip (returns presigned URLs)
app.get("/api/photos/:tripId", async (req, res) => {
  try {
    const tripId = req.params.tripId;
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${tripId}/` })
    );
    const items = await Promise.all(
      (out.Contents || []).map(async (o) => ({
        key: o.Key,
        size: o.Size,
        last_modified: o.LastModified,
        url: await presign(o.Key),
      }))
    );
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "list failed" });
  }
});

// Delete a photo by key (key contains the trip prefix)
app.delete("/api/photos/item/*", async (req, res) => {
  try {
    const key = req.params[0];
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "delete failed" });
  }
});

// Presigned GET URLs are returned to the browser, so they must point at an
// endpoint the browser can reach. Inside the cluster MinIO is addressed via a
// service DNS name the browser cannot resolve, so presign against a separate
// browser-facing client when S3_PUBLIC_ENDPOINT is provided (e.g. an Ingress
// host like http://minio.tripmate.local). Falls back to the internal client.
const presignClient = process.env.S3_PUBLIC_ENDPOINT
  ? new S3Client({
      region: REGION,
      endpoint: process.env.S3_PUBLIC_ENDPOINT,
      forcePathStyle: FORCE_PATH_STYLE,
    })
  : s3;

function presign(key) {
  return getSignedUrl(
    presignClient,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: URL_TTL }
  );
}

ensureBucket().finally(() =>
  app.listen(PORT, () =>
    console.log(
      `photo-service listening on ${PORT}, bucket=${BUCKET}` +
        (S3_ENDPOINT ? `, endpoint=${S3_ENDPOINT}` : "")
    )
  )
);
