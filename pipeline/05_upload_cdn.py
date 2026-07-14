"""Step 05 — Upload raw PACS JPEGs to S3 (fronted by CloudFront).

Walks RAW_DIR/**/*.jpg and uploads each to:

    s3://<S3_BUCKET>/<S3_PREFIX>/<domain>/<class>/<stem>.jpg

with ContentType=image/jpeg so browsers render them inline. The manifest's
`cdnBase` points at the CloudFront distribution in front of this bucket, and
each image's `file` field is the "<domain>/<class>/<stem>.jpg" suffix, so the
final URL is `${cdnBase}/${file}`.

AWS credentials come from the standard boto3 chain (env vars, ~/.aws/config,
instance role, etc.). If they're missing/misconfigured we print a clear message
instead of crashing — and `boto3` is imported lazily so this file stays
import-safe for `python -m py_compile`.

Run (after 01; needs configured AWS creds + a real S3_BUCKET):
    python 05_upload_cdn.py
"""

from __future__ import annotations

from pathlib import Path

import config


def _iter_jpegs():
    """Yield (local_path, s3_key) for every JPEG under RAW_DIR."""
    for path in sorted(config.RAW_DIR.rglob("*.jpg")):
        # key = <prefix>/<domain>/<class>/<stem>.jpg
        rel = path.relative_to(config.RAW_DIR).as_posix()
        key = f"{config.S3_PREFIX}/{rel}"
        yield path, key


def _print_cloudfront_notes() -> None:
    print(
        "\n--- CloudFront setup notes ---\n"
        f"1. Bucket '{config.S3_BUCKET}' should be PRIVATE; serve it via a "
        "CloudFront distribution using an Origin Access Control (OAC).\n"
        "2. Restrict the bucket policy to the CloudFront distribution's OAC "
        "principal (no public-read on the bucket itself).\n"
        "3. Set the distribution's default root behavior to cache image/jpeg "
        "with a long TTL (these JPEGs are immutable).\n"
        "4. Enable CORS on the distribution if the web app and CDN are on "
        "different origins (GET/HEAD, Access-Control-Allow-Origin: <web origin>).\n"
        f"5. Point config.CDN_BASE at https://<dist>.cloudfront.net/"
        f"{config.S3_PREFIX} and rebuild the manifest (step 04).\n"
        f"6. After re-uploads, invalidate the cache for distribution "
        f"'{config.CLOUDFRONT_DIST}' (e.g. aws cloudfront create-invalidation "
        "--paths '/*').\n"
    )


def main() -> None:
    # Lazy import so py_compile / import never requires boto3 to be installed.
    try:
        import boto3  # type: ignore
        from botocore.exceptions import (  # type: ignore
            BotoCoreError,
            ClientError,
            NoCredentialsError,
        )
    except ImportError:
        print("ERROR: boto3 is not installed. `pip install boto3` to upload.")
        return

    from tqdm import tqdm  # type: ignore

    if "REPLACE" in config.S3_BUCKET:
        print(f"ERROR: S3_BUCKET is still a placeholder ('{config.S3_BUCKET}'). "
              "Set config.S3_BUCKET to a real bucket before uploading.")
        return

    if not config.RAW_DIR.exists():
        print(f"ERROR: {config.RAW_DIR} does not exist. Run 01_download_pacs.py first.")
        return

    items = list(_iter_jpegs())
    if not items:
        print(f"No .jpg files found under {config.RAW_DIR}. Nothing to upload.")
        return

    # Build the client and verify credentials up front so a missing/invalid AWS
    # config produces a clear message rather than a per-file failure storm.
    try:
        s3 = boto3.client("s3")
        # Cheap credential/permission probe.
        s3.head_bucket(Bucket=config.S3_BUCKET)
    except NoCredentialsError:
        print("ERROR: No AWS credentials found. Configure them via `aws configure`, "
              "environment variables, or an instance role, then retry.")
        return
    except (ClientError, BotoCoreError) as exc:
        print(f"ERROR: Could not access bucket '{config.S3_BUCKET}': {exc}")
        return

    print(f"Uploading {len(items)} JPEGs to s3://{config.S3_BUCKET}/{config.S3_PREFIX}/ ...")
    uploaded = 0
    for path, key in tqdm(items, desc="upload"):
        try:
            s3.upload_file(
                Filename=str(path),
                Bucket=config.S3_BUCKET,
                Key=key,
                ExtraArgs={"ContentType": "image/jpeg"},
            )
            uploaded += 1
        except (ClientError, BotoCoreError) as exc:
            print(f"  failed {key}: {exc}")

    print(f"Uploaded {uploaded}/{len(items)} objects.")
    _print_cloudfront_notes()


if __name__ == "__main__":
    main()
