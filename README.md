# BatchFrame

A fast, keyboard-driven desktop application to cull, organize, and manage large collections of images and select non-image files. Designed for speed, it works well for digital asset management, photography culling, and organizing visual references. Built with Electron and React.

It also syncs to Google Drive, runs a local AI toolkit for finding duplicates, originals, and visual clusters, and can mirror itself to your phone or tablet over Wi-Fi so you can review shots on a second screen.

## Key Features

### 📂 Organization & Curation
- **Responsive Grid & List Views**: View your images as a scalable grid (with contain/cover aspect ratios) or in detailed list views.
- **Bulk Actions**: Copy, Move, or Rename large numbers of images simultaneously.
- **Bulk Renaming**: Add custom prefixes and auto-incrementing zero-padded digits to standardize your filenames.
- **Reference Tagging**: Tag selected images as references for specific concepts or characters.
- **Advanced Filtering**: Filter your folder by aspect ratio (Square, Portrait, Landscape, Ultra-Wide, etc.) or search by name.

### ✨ Selection & Workflow
- **Lasso Drag Selection**: Click and drag across the screen to quickly select groups of images.
- **Shift-Click Range Selection**: Select an image, hold `Shift`, and click another to select everything in between.
- **Image Locking**: "Lock" important images to prevent them from being accidentally deleted or moved.
- **Order Selection**: Keep track of the exact sequential order in which you clicked images.
- **Invert Selection**: Instantly flip your selection state.

### 📄 Text & Non-Image Support
- **Text File Previews**: Quickly preview text files alongside images with interactive tag filtering and selection.
- **Visual Placeholders**: Instantly identify non-image files like `ZIP`, `TXT`, `TORRENT`, and `SAFETENSORS` in the grid.

### 🤖 AI Tools (expandable AI menu)
The `AI ▾` toolbar button expands inline to reveal a group of tools. The currently-running tool gets a rotating chase outline so you always know something is working.
- **Scan** — Local character/concept recognition. Images receive a percentage match score badge to weed out false positives.
- **Dupes** — Finds near-duplicate images with perceptual hashing (DHash + Hamming distance) and auto-selects the extras for deletion.
- **Source** — Match Photoshop-edited exports back to their original raw images. Uses DHash which is invariant to color/tone edits. Perfect for the "I edited 200 favorites and want to delete the 800 raws I never used" workflow. Pick the edited folder in the in-app picker, and unmatched raws are selected in the grid for you to delete.
- **Cluster** — Groups the current view by visual similarity (CLIP embeddings + KMeans). Same-cluster images sit adjacent in the grid with a colored border chip and a sticky cluster header at the top of the viewport. Great for reviewing large batches without picking five near-identical shots.
- **Shuffle** — Randomizes the current view. Removes first-image position bias when you're eyeballing 200+ candidates.

While an AI action runs:
- The specific button (Source / Cluster / Dupes / Scan) shows a rotating chase outline.
- The current image being processed gets an animated outline (pulsing glow + sweeping highlight).
- The grid auto-scrolls to follow, switching pages if needed.

### ✨ UI polish
- **Themed dialogs** — All alerts, confirmations, and notices render as in-app modals matching the dark theme. No native OS popups.
- **In-app folder picker** — A terminal-style folder navigator with fuzzy search, keyboard nav, and inline folder creation. Right-click anywhere in the picker to toggle "Show images" (revealing image contents alongside folders so you can confirm you're in the right place). Preference is saved.
- **Custom order** — Cluster and Shuffle set a custom image order that overrides the default sort. Changing the sort dropdown clears it. A `Reset` button appears in the AI menu while a custom order is active.
- **Native menu bar** — A standard application menu (Edit / View / Window, plus the app menu on macOS) so system copy/paste, zoom, reload, and fullscreen behave the way you'd expect.

### ☁️ Google Drive Sync
- **Cloud Sync**: Directly pull and push folders from/to a Google Drive account with advanced sync strategies.
- **Conflict Resolution**: Safely detects unsynced changes and prompts you if there are remote conflicts before overwriting.
- **Local Caching**: Images are cached locally for instantaneous loading, with a tiny visual indicator showing sync status.
- **Operation Cancellation**: Easily cancel long-running Google Drive API requests.
- **Live Drive Mode** (`Cmd/Ctrl+Shift+D`): Open a Drive folder directly as your workspace — no pull, no push. Renames, moves, deletes, and crops apply straight to Drive as you make them (deletes go to Drive's trash). The grid loads from Drive thumbnails; nothing is bulk-downloaded. Photoshop and AI scanning are unavailable in this mode since they need real local files.

### 📱 Remote Access

The **Remote** button in the toolbar starts a small server on your local network so a second device — phone, tablet, or another laptop — can open a URL and mirror the app. Handy for judging shots on a phone screen, or handing a tablet to someone else while you cull.

- **Scan and go**: Starting the server shows a QR code and a URL. Any device on the same Wi-Fi opens it in a browser — no install, no account, no sign-in.
- **Live mirror**: The remote follows the desktop's folder, subfolders, open preview, and which images are selected. Navigating on the remote drives the desktop back, so you can browse from across the room. Turn `Sync desktop` off in the menu to look around on your own without moving the desktop.
- **Scroll preview**: An optional continuous vertical feed (`Scroll preview` in the menu) for thumbing through a whole shoot. Your scroll position keeps the desktop in step.
- **Read-only culling**: The remote browses and drives the preview, but cannot select, move, rename, or delete. Destructive actions stay on the desktop.
- **Drive-aware**: Live Drive folders work too — the remote materializes thumbnails on demand rather than bulk-downloading.
- **Direct, not cloud**: Devices talk straight to your machine — there is no relay, account, or third-party service involved. The server picks a random free port and mints a fresh random token each time you start it; every request, including the WebSocket, is rejected without that token, and old URLs stop working once you stop the server.
- **Know your network**: The server listens on all network interfaces, so on a normal home or office network behind a router it is reachable only from your LAN. On an untrusted network (café Wi-Fi, a conference, or a machine with port forwarding) anyone on that network can reach the port — they would still need the token, but the safe habit is to stop the server from the same panel when you're finished.

#### Remote gestures

| Gesture | Standard preview | Scroll preview |
|---|---|---|
| Tap left / right third | Previous / next image | — |
| Tap centre | Show or hide the controls | Show or hide the controls |
| Swipe across | Previous / next image | — |
| Swipe down | Close the preview | — |
| **Double-tap** | Fill the screen; again to fit | Fill the screen, centred; again to return to the feed |
| **Pinch** | Zoom freely, up to 8× | Lifts the frame into a magnifier that springs back on release |
| **One finger dragging** | Pans once zoomed, sticking at the edges | Pans only while you keep a finger down after a pinch |
| **Two fingers sliding together** | — | Shift the frame around, sticking at the edges |

In scroll preview, two fingers do two different things: moving them *apart or together* zooms, while sliding them *as a pair* shifts the frame. Whichever you start with locks in for that gesture, so a sideways drag never jitters the zoom.

A pinch magnifier stays up as long as any finger is still touching, so you can lift to one finger and keep panning; it springs back only when you let go completely. On a magnifier opened by *double-tap* the rules differ slightly — it stays open on its own, two fingers move it around, and a one-finger drag scrolls the feed and dismisses it. `Esc` or another double-tap also closes it.

Back in the thumbnail grid, pinching resizes the thumbnails (`Ctrl`/`⌘`+wheel on a laptop), and double-tapping the folder bar or any empty space toggles fullscreen.

On a laptop the same things work with a mouse: double-click to fill, wheel to zoom in the standard preview, `Ctrl`/`⌘`+wheel to magnify in scroll preview, and drag to pan.

The scroll-preview magnifier is deliberately transient — it floats above the feed rather than resizing it, so your place in the feed never shifts and the desktop doesn't jump around while you inspect a frame.

### 🎨 Deep Integrations
- **Photoshop Link**: One-click export of selected images directly into Adobe Photoshop for manual touch-ups.

## Keyboard Shortcuts

Power users can navigate entirely via the keyboard (when not focused on a text input):

- **1, 2, 3, 4** - Set image preview size to S, M, L, XL respectively
- **V** - Toggle between Grid view and List view
- **T** - Toggle thumbnail/plain mode in List view (or Cover/Contain fit in Grid view)
- **D** - Toggle Drag Select mode
- **O** - Toggle Order Selection mode
- **Q** - Toggle Auto-Reload (watch for file changes)
- **N** - Toggle Confirmations (delete/move prompts)
- **A** - Open the AI menu; press again to cycle focus through Scan → Dupes → Source → Cluster → Shuffle. Press **Enter** to activate the focused item.
- **Shift + A** - Close the AI menu
- **C** - Copy selected images
- **M** - Move selected images
- **R** - Bulk rename selected images
- **F** - Use selected images as reference
- **P** - Open selected in Adobe Photoshop
- **I** - Invert the current selection
- **L** - Lock selected images
- **Shift + L** - Unlock selected images
- **Del / Backspace** - Delete selected images (sends to Recycle Bin)
- **Shift + Del** - Keep selected, delete everything else
- **Ctrl+D / Cmd+D** - Open the Google Drive panel (pull/push sync)
- **Ctrl+Shift+D / Cmd+Shift+D** - Open a Drive folder live (edits apply directly to Drive)
- **Ctrl+A / Cmd+A** - Select all images
- **S** - Cycle sorting method (Name, Date, Size)
- **Shift + S** - Toggle sorting direction (Ascending / Descending)
- **Escape** - Deselect all images
- **Ctrl+Shift+O / Cmd+Shift+O** - Sign out of Google Drive
- **Space / Shift+Space** - Scroll page up/down continuously
- **Ctrl+Cmd+F** - Toggle window fullscreen (also in the View menu, where the platform default applies)

## Installation & Setup

1. Clone this repository or download the project.
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Install Python dependencies (required for AI tools):
   ```bash
   # Minimum for Find Dupes and Find Source:
   python3 -m pip install --user Pillow

   # Full AI stack (adds Cluster + AI Scan; ~1GB download for torch):
   python3 -m pip install --user -r requirements.txt
   ```
   Each AI tool preflights its imports on run — if a dep is missing you get a themed dialog telling you the exact `pip install` command to fix it.
4. Set up Google Drive Sync (optional):
   - Create a `.env` file in the root directory.
   - Add your Google OAuth credentials:
     ```env
     GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=your-client-secret
     ```
5. Start the development version:
   ```bash
   npm run dev
   ```

To build for production:
```bash
npm run build
```

### Python dependency reference

| Tool | Requires |
|---|---|
| Find Dupes | `Pillow` |
| Find Source | `Pillow` |
| Cluster | `Pillow`, `numpy`, `torch`, `open_clip_torch` |
| AI Scan | `dghs-imgutils`, `torch`, `open_clip_torch` |

## Built With

- **Electron** - Desktop app framework
- **React** - UI framework
- **Node.js** - Backend API and file system interactions
- **Express + ws** - The LAN remote server and its live state channel (`qrcode` generates the pairing code)
- **Python 3** - AI subprocesses (spawned from Electron main): DHash matching for Dupes/Source, CLIP embeddings for Cluster, CCIP/CLIP for character Scan
