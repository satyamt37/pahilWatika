# Free storage for photos and videos

Limits change, so confirm on each provider's pricing page before relying on a number.

## Options compared

| Option | Free allowance | Good for | Catches |
|---|---|---|---|
| **Supabase Storage** (used) | ~1 GB files, 50 MB max per file, plus a 500 MB database | Photos, short videos, MP3, receipts. It shares login and security rules with the database | Project pauses after 7 days idle (handled by the keep-alive workflow). Pro plan is $25/month for 100 GB |
| **YouTube (unlisted)** (supported) | Effectively unlimited | Long videos: picnic and festival recordings | Videos are hosted on YouTube. In the gallery choose *Add YouTube link* |
| Cloudflare R2 | 10 GB-month storage, no egress fees | A future upgrade when photos exceed 1 GB | Needs a card on file and a small Worker to sign uploads |
| Cloudinary | Monthly "credits" shared between storage, bandwidth and transformations | Automatic image and video optimisation | Credits run out with heavy viewing. Unsigned uploads would need care |
| Google Drive / Google Photos | 15 GB per Google account | A raw archive of originals | No API-level privacy integration with this app |
| Firebase Storage | Now requires the pay-as-you-go plan | — | No longer free without a billing account |

## What this app does to stay free

* **Compression in the browser:** each photo is stored as a 2048 px high-quality JPEG (about 300–600 KB) plus a 480 px thumbnail (about 40 KB). A 6 MB phone photo uses roughly 0.5 MB, so **about 2,000 photos fit in 1 GB**.
* **Originals are optional:** *Admin → Website settings → Keep full-size originals* is off by default. Turn it on only if space allows.
* **Duplicate photos are refused** (SHA-256 hash), so the same picture uploaded by five people is stored once.
* **Trash then purge:** deleted photos go to the trash first. *Admin → Photos → Trash → Empty trash* frees the space.
* **Storage meter:** *Admin → Overview* and *Admin → Photos* show usage against 1 GB.
* **Videos:** short clips (≤ 50 MB) upload directly. Longer videos go on YouTube (unlisted) and are added as a link.

## When the 1 GB fills up

1. Empty the trash, and keep "originals" off.
2. Move long videos to YouTube links.
3. Upgrade to Supabase Pro (100 GB), or add a second free Supabase project only for media. A move to Cloudflare R2 would need a small code change to the upload path in `src/components/gallery/Uploader.tsx`.
