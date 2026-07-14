# Image Dataset Selector

A highly advanced, lightning-fast desktop application to select, organize, and curate images for machine learning datasets. Built with Electron and React.

## Advanced Features

### 📂 Organization & Curation
- **Intelligent Grid & List Views**: View your dataset as a scalable grid (with contain/cover aspect ratios) or in detailed list views.
- **Bulk Actions**: Copy, Move, or Rename large numbers of images simultaneously.
- **Bulk Renaming**: Add custom prefixes and auto-incrementing zero-padded digits to standardize your dataset filenames.
- **Reference Management**: Set specific characters/concepts and tag selected images as references for them.
- **Advanced Filtering**: Filter your dataset by aspect ratio (Square, Portrait, Landscape, Ultra-Wide, etc.) or search by name.

### ✨ Selection & Workflow
- **Lasso Drag Selection**: Click and drag across the screen to quickly select groups of images.
- **Shift-Click Range Selection**: Select an image, hold `Shift`, and click another to select everything in between.
- **Image Locking**: "Lock" important images to prevent them from being accidentally deleted or moved.
- **Order Selection**: Keep track of the exact sequential order in which you clicked images.
- **Invert Selection**: Instantly flip your selection state.

### 🤖 AI Integration & Similarity Scoring
- **Local AI Scanning**: Connects to a local image recognition backend to scan your dataset for specific characters or concepts.
- **Similarity Badges**: Images receive a percentage match score badge, making it easy to weed out false positives in your dataset.

### ☁️ Google Drive Sync
- **Cloud Native**: Directly pull and push datasets from/to a Google Drive folder.
- **Conflict Resolution**: Safely detects unsynced changes and prompts you if there are remote conflicts before overwriting.
- **Local Caching**: Images are cached locally for instantaneous loading, with a tiny visual indicator showing sync status.

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
- **A** - Toggle the AI character scan panel
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
- **Ctrl+A / Cmd+A** - Select all images
- **Escape** - Deselect all images
- **Space / Shift+Space** - Scroll page up/down continuously

## Installation & Setup

1. Clone this repository or download the project
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up Google Drive Sync (Optional):
   - Create a `.env` file in the root directory.
   - Add your Google OAuth credentials:
     ```env
     GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=your-client-secret
     ```
4. Start the development version:
   ```bash
   npm run dev
   ```

To build for production:
```bash
npm run build
```

## Built With

- **Electron** - Desktop app framework
- **React** - UI framework
- **Node.js** - Backend API and file system interactions
