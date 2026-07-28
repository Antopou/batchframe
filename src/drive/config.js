// Google OAuth 2.0 Desktop-client credentials.
//
// One-time setup:
//   1. Go to https://console.cloud.google.com/apis/credentials
//   2. Enable the Google Drive API for the project
//   3. Create Credentials → OAuth client ID → Application type: Desktop app
//   4. Paste the values below and rebuild the app.
//
// These stay on the user's machine only. The client secret in a desktop OAuth
// client is not a real secret — Google treats it as public — so shipping it in
// source is expected practice.

// dotenv defaults to cwd, which is unpredictable for a packaged app (it is the
// folder the .exe was launched from). Look in the repo root for dev and in
// resources/ for a packaged build, and let a real environment variable win.
const path = require('path');
const { app } = require('electron');

const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '..', '..', '.env');

require('dotenv').config({ path: envPath });

module.exports = {
  CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
};
