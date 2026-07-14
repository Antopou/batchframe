// Thin wrappers around Google Drive v3 endpoints used by the sync engine.
// Callers pass in an authenticated OAuth2 client (from oauthClient.getAuthClient).

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function driveFor(auth) {
  return google.drive({ version: 'v3', auth });
}

// Detects an image by mimeType prefix OR by extension (some uploads land as
// application/octet-stream).
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);
function isImage(file) {
  if (file.mimeType && file.mimeType.startsWith('image/')) return true;
  const ext = path.extname(file.name || '').toLowerCase();
  return IMAGE_EXTS.has(ext);
}

async function getAbout(auth) {
  const drive = driveFor(auth);
  const { data } = await drive.about.get({ fields: 'user(displayName,emailAddress),storageQuota' });
  return data;
}

// Lists a Drive folder's direct children (folders + non-trashed files).
// Handles pagination.
async function listFolder(auth, folderId, { includeAll = false } = {}) {
  const drive = driveFor(auth);
  const items = [];
  let pageToken;
  do {
    const { data } = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, md5Checksum, size, modifiedTime, parents, thumbnailLink, hasThumbnail)',
      pageSize: 1000,
      pageToken,
      spaces: 'drive',
    });
    for (const f of data.files || []) {
      if (f.mimeType === FOLDER_MIME || includeAll || isImage(f)) {
        items.push(f);
      }
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

// Recursively walks a Drive folder and yields image files with their relative
// path (POSIX-style, relative to rootId). Empty folders are returned too so we
// can materialize them locally.
async function walkFolder(auth, rootId) {
  const files = []; // { id, name, relPath, mimeType, md5, size, modifiedTime }
  const folders = []; // { id, relPath }

  async function recurse(parentId, prefix) {
    const children = await listFolder(auth, parentId);
    for (const c of children) {
      const relPath = prefix ? `${prefix}/${c.name}` : c.name;
      if (c.mimeType === FOLDER_MIME) {
        folders.push({ id: c.id, relPath });
        await recurse(c.id, relPath);
      } else if (isImage(c)) {
        files.push({
          id: c.id,
          name: c.name,
          relPath,
          mimeType: c.mimeType,
          md5: c.md5Checksum || null,
          size: c.size ? Number(c.size) : null,
          modifiedTime: c.modifiedTime,
        });
      }
    }
  }
  await recurse(rootId, '');
  return { files, folders };
}

async function getFileMetadata(auth, fileId) {
  const drive = driveFor(auth);
  const { data } = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, md5Checksum, size, modifiedTime, parents, trashed',
  });
  return data;
}

// Streams a Drive file to destPath. Optional onBytes(delta) callback.
async function downloadFile(auth, fileId, destPath, { onBytes } = {}) {
  const drive = driveFor(auth);
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    res.data.on('data', (chunk) => onBytes && onBytes(chunk.length));
    res.data.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.data.pipe(out);
  });
}

// Creates a new file in the given parent folder. Returns the new fileId.
async function uploadFile(auth, { parentId, name, localPath, mimeType }) {
  const drive = driveFor(auth);
  const { data } = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: fs.createReadStream(localPath),
    },
    fields: 'id, name, md5Checksum, size, modifiedTime, parents',
  });
  return data;
}

// Replaces the media of an existing file. Optionally renames / re-parents.
async function updateFile(auth, fileId, { localPath, mimeType, name, addParents, removeParents } = {}) {
  const drive = driveFor(auth);
  const params = {
    fileId,
    fields: 'id, name, md5Checksum, size, modifiedTime, parents',
  };
  if (name || addParents || removeParents) {
    params.requestBody = {};
    if (name) params.requestBody.name = name;
    if (addParents) params.addParents = addParents;
    if (removeParents) params.removeParents = removeParents;
  }
  if (localPath) {
    params.media = {
      mimeType: mimeType || 'application/octet-stream',
      body: fs.createReadStream(localPath),
    };
  }
  const { data } = await drive.files.update(params);
  return data;
}

async function trashFile(auth, fileId) {
  const drive = driveFor(auth);
  await drive.files.update({ fileId, requestBody: { trashed: true } });
}

async function createFolder(auth, { parentId, name }) {
  const drive = driveFor(auth);
  const { data } = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    },
    fields: 'id, name, parents',
  });
  return data;
}

async function getStartPageToken(auth) {
  const drive = driveFor(auth);
  const { data } = await drive.changes.getStartPageToken();
  return data.startPageToken;
}

// Returns all changes since `pageToken` (paginated). Each change: { fileId, file, removed, time }.
async function listChanges(auth, pageToken) {
  const drive = driveFor(auth);
  const changes = [];
  let token = pageToken;
  let newStartPageToken = null;
  while (token) {
    const { data } = await drive.changes.list({
      pageToken: token,
      fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, time, file(id, name, parents, md5Checksum, modifiedTime, trashed))',
      pageSize: 1000,
      spaces: 'drive',
    });
    for (const c of data.changes || []) changes.push(c);
    if (data.newStartPageToken) newStartPageToken = data.newStartPageToken;
    token = data.nextPageToken || null;
  }
  return { changes, newStartPageToken };
}

module.exports = {
  FOLDER_MIME,
  isImage,
  getAbout,
  listFolder,
  walkFolder,
  getFileMetadata,
  downloadFile,
  uploadFile,
  updateFile,
  trashFile,
  createFolder,
  getStartPageToken,
  listChanges,
};
