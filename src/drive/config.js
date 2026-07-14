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

module.exports = {
  CLIENT_ID: '',
  CLIENT_SECRET: '',
};
