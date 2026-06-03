import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const DEFAULT_BUCKET = "ai-office-worker-backups";

type RequiredEnvName =
  | "DIRECT_URL"
  | "R2_ACCOUNT_ID"
  | "R2_ACCESS_KEY_ID"
  | "R2_SECRET_ACCESS_KEY";

function requiredEnv(name: RequiredEnvName): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function validatePostgresUrl(name: "DIRECT_URL", value: string): string {
  if (!value.startsWith("postgresql://") && !value.startsWith("postgres://")) {
    throw new Error(
      `${name} is missing or malformed - it must start with postgresql://`
    );
  }

  return value;
}

function formatTimestamp(date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}-${hh}${min}${ss}`;
}

function pgEnvFromDirectUrl(directUrl: string): NodeJS.ProcessEnv {
  let url: URL;
  try {
    url = new URL(directUrl);
  } catch {
    throw new Error("DIRECT_URL is not a valid PostgreSQL connection URL");
  }

  if (!url.hostname || !url.pathname || !url.username) {
    throw new Error("DIRECT_URL is missing required PostgreSQL connection fields");
  }

  const pgEnv: NodeJS.ProcessEnv = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
  };

  if (url.password) {
    pgEnv.PGPASSWORD = decodeURIComponent(url.password);
  }

  const sslMode = url.searchParams.get("sslmode");
  if (sslMode) {
    pgEnv.PGSSLMODE = sslMode;
  }

  const channelBinding = url.searchParams.get("channel_binding");
  if (channelBinding) {
    pgEnv.PGCHANNELBINDING = channelBinding;
  }

  return pgEnv;
}

function runPgDump(directUrl: string, outputPath: string): Promise<void> {
  const pgEnv = pgEnvFromDirectUrl(directUrl);

  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", ["-Fc", "--file", outputPath], {
      env: {
        ...process.env,
        ...pgEnv,
      },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });

    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            "pg_dump was not found. Install PostgreSQL client tools that match your Neon Postgres server major version and ensure pg_dump is on PATH."
          )
        );
        return;
      }

      reject(new Error(`pg_dump failed to start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const sanitizedError = stderr.trim() || `pg_dump exited with code ${code}`;
      reject(new Error(`pg_dump failed: ${sanitizedError}`));
    });
  });
}

async function main() {
  const directUrl = validatePostgresUrl("DIRECT_URL", requiredEnv("DIRECT_URL"));
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = requiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("R2_SECRET_ACCESS_KEY");
  const bucket = process.env.R2_BUCKET || DEFAULT_BUCKET;

  const timestamp = formatTimestamp();
  const objectKey = `backups/ai-office-worker-${timestamp}.dump`;
  const tempDir = await mkdtemp(path.join(tmpdir(), "ai-office-worker-backup-"));
  const dumpPath = path.join(tempDir, `ai-office-worker-${timestamp}.dump`);

  try {
    console.log("starting dump");
    await runPgDump(directUrl, dumpPath);

    const dumpStats = await stat(dumpPath);
    const sizeMb = (dumpStats.size / 1024 / 1024).toFixed(2);
    console.log(`dump complete (size: ${sizeMb} MB)`);

    const client = new S3Client({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      region: "auto",
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    console.log("uploading to R2");
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: createReadStream(dumpPath),
        ContentLength: dumpStats.size,
        ContentType: "application/octet-stream",
      })
    );

    await rm(tempDir, { recursive: true, force: true });
    console.log(`upload complete: ${objectKey}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`backup failed: ${message}`);
    process.exitCode = 1;
  }
}

main();
