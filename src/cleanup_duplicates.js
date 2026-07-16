const { app } = require('electron');
app.name = 'batchframe';
const { getAuthClient } = require('./drive/oauthClient');
const driveApi = require('./drive/driveApi');
const fs = require('fs');

app.whenReady().then(async () => {
  try {
    const auth = await getAuthClient();
    console.log("Connected to Drive.");
    
    const manifestPath = process.argv[2];
    if (!manifestPath) {
      console.log("Usage: npx electron src/cleanup_duplicates.js <path-to-.sync-manifest.json>");
      app.quit();
      return;
    }
    
    const manifestStr = fs.readFileSync(manifestPath, 'utf8');
    const m = JSON.parse(manifestStr);
    const driveFolderId = m.driveFolderId;
    
    if (!driveFolderId) {
      console.log("No driveFolderId found in manifest.");
      app.quit();
      return;
    }
    
    console.log(`Scanning Drive Folder ID: ${driveFolderId}...`);
    const { folders, files } = await driveApi.walkFolder(auth, driveFolderId);
    
    // Group folders by lowercase relative path
    const groups = {};
    for (const f of folders) {
      const key = (f.relPath || '').toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    
    const filePaths = files.map(f => f.relPath);
    let trashedCount = 0;
    
    for (const [key, duplicateFolders] of Object.entries(groups)) {
      if (duplicateFolders.length > 1) {
        console.log(`\nFound duplicates for '${key}':`, duplicateFolders.map(d => d.name));
        
        for (const df of duplicateFolders) {
           // check if it has any files underneath it (direct or nested)
           const hasFiles = filePaths.some(fp => fp === df.relPath || fp.startsWith(df.relPath + '/'));
           if (!hasFiles) {
             console.log(`  -> Trashing empty duplicate: ${df.name} (${df.id})`);
             await driveApi.trashFile(auth, df.id);
             trashedCount++;
           } else {
             console.log(`  -> KEEPING non-empty folder: ${df.name} (${df.id})`);
           }
        }
      }
    }
    
    console.log(`\nCleanup complete! Trashed ${trashedCount} empty duplicate folder(s).`);
  } catch (err) {
    console.error("Error during cleanup:", err);
  } finally {
    app.quit();
  }
});
