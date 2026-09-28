const express = require("express");
const cors = require("cors");
const multer = require("multer");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const PORT = process.env.PORT || 3000;
const REGION = process.env.AWS_REGION || "ap-south-1";
const BUCKET = process.env.PHOTO_BUCKET; // required
const URL_TTL = Number(process.env.PRESIGN_TTL || 3600);

if (!BUCKET) {
  console.error("PHOTO_BUCKET env var is required");
  process.exit(1);
}

const s3 = new S3Client({ region: REGION });
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

function presign(key) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: URL_TTL,
  });
}

app.listen(PORT, () => console.log(`photo-service listening on ${PORT}, bucket=${BUCKET}`));
