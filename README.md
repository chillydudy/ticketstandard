<div align="center">
  <img src="public/images/ticketstandard-wordmark.png" alt="TicketStandard" width="620" />

  <h1>Customer photos, ready for review.</h1>
  <p>A browser-based photo studio for preparing clear, consistent customer images for support tickets.</p>
  <p>
    <a href="https://github.com/chillydudy/ticketstandard">Source code</a>
    &nbsp;·&nbsp;
    <a href="https://github.com/chillydudy/ticketstandard/issues">Report an issue</a>
  </p>
</div>

---

## What it does

TicketStandard helps support teams turn customer-submitted photos into review-ready copies. Open a photo, correct its orientation and framing, make visual adjustments, then export a separate copy. The source image is kept intact.

### Prepare a photo

- Open a JPEG, PNG, or WebP image up to 40 MB, or drag it into the studio.
- Rotate, straighten, flip, crop, and zoom to bring the important detail into view.
- Adjust exposure, contrast, saturation, warmth, and sharpness; choose a color filter when useful.
- Fit the full image to an original, square, portrait, or landscape frame, with background and fill controls for empty areas.
- Compare the edited result with the source, inspect details, and undo or redo changes.
- Save a new PNG, JPEG, or WebP copy with a chosen filename. The original file is never overwritten.

### Refine blur

The **Refine** tool can use the optional local NAFNet model to reduce blur. The model runs through a local service on your computer; it is not included in Git because its weights are large. Standard editing works without this setup.

## Product visuals

The landing page demonstrates the camera and film-strip story. The studio's sample flow uses the model-kit photo below to show a tilted submission, a straightened view, and a refined detail.

<table>
  <tr>
    <td align="center" width="33%">
      <img src="public/images/lego-kit-original-tilted.png" alt="Model-kit photo as submitted, with a visible tilt" width="100%" />
      <br /><strong>As submitted</strong>
    </td>
    <td align="center" width="33%">
      <img src="public/images/lego-kit-rotated-fit.jpg" alt="Model-kit photo straightened and fitted without cropping" width="100%" />
      <br /><strong>Straightened</strong>
    </td>
    <td align="center" width="33%">
      <img src="public/images/bag-detail-refined.webp" alt="Refined close-up of a numbered model-kit parts bag" width="100%" />
      <br /><strong>Quality refined</strong>
    </td>
  </tr>
</table>

> These are example photos used by the product demo, not screenshots of the interface.

## Run locally

### Requirements

- Node.js and npm
- Windows PowerShell only if you want to set up the optional local blur-refinement model

### Start the website

```bash
git clone https://github.com/chillydudy/ticketstandard.git
cd ticketstandard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The main landing page is `/`; the editor is available at `/workspace`.

### Optional: enable local Refine

Install Python 3.11, then run this from PowerShell:

```powershell
npm run ai:setup
npm run dev
```

The setup script installs the CPU runtime and downloads the NAFNet GoPro model (about 270 MB). The model files are stored in `local_ai/models/` and are intentionally excluded from Git. The local inference service listens on `127.0.0.1`.

## How photo data is handled

- Standard photo edits run in the browser on the user's device.
- The site does not upload photos to application storage, retain user files, or maintain an edit history.
- When **Refine** is enabled, the selected photo is sent to the local inference service on that same computer.
- The optional refinement service is intended for local use and is not available from a deployed website without separate server configuration.

## Project layout

```text
app/                 Next.js routes and API endpoint
components/          Landing page, studio, camera, and UI components
lib/ticketstandard/  Browser image processing and rendering worker
local_ai/            Optional local NAFNet service
public/images/       Active landing-page, studio, and sample-photo assets
scripts/             Development and local-model setup helpers
```

## Useful commands

```bash
npm run dev       # Start the development server
npm run build     # Create a production build
npm run start     # Serve the production build
npm run ai:setup  # Optional local AI setup (Windows, Python 3.11)
npm run ai:demos  # Generate before/after Refine demos in demos/ (needs npm run dev running)
```

Once `npm run ai:setup` has been run, `npm run dev` also starts the local NAFNet service on `127.0.0.1:8765`. Set `TICKETSTANDARD_SKIP_AI=1` to start the website without it.

## Credits

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for notices covering the active runtime and optional local Refine service.
