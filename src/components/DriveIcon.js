import React from 'react';

// Google Drive multi-color triangle logo. Six paths, per Google's brand asset.
function DriveIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87 78" aria-hidden>
      <path fill="#0066DA" d="M6.6 66.85 10.6 73.6a9.65 9.65 0 0 0 3.55 3.55l14.3-24.75H0a9.65 9.65 0 0 0 1.4 5l5.2 8.5z"/>
      <path fill="#00AC47" d="M43.65 25 29.35 0a9.65 9.65 0 0 0-3.55 3.55L0 52.4a9.65 9.65 0 0 0-1.4 5H28.45L43.65 25z"/>
      <path fill="#EA4335" d="M73.55 77.15A9.65 9.65 0 0 0 77.1 73.6l1.65-2.85 7.85-13.6a9.65 9.65 0 0 0 1.4-5H58.7l6.2 12.2 8.65 12.8z"/>
      <path fill="#00832D" d="M43.65 25 57.95 0a9.15 9.15 0 0 0-4.85-1.4H34.2a9.65 9.65 0 0 0-4.85 1.4L43.65 25z"/>
      <path fill="#2684FC" d="M58.7 52.4H28.45L14.15 77.15a9.15 9.15 0 0 0 4.85 1.4h49.3a9.15 9.15 0 0 0 4.85-1.4L58.7 52.4z"/>
      <path fill="#FFBA00" d="m73.4 26.55-14.6-25a9.65 9.65 0 0 0-3.55-3.55L43.65 25 58.7 52.4h28.4a9.65 9.65 0 0 0-1.4-5l-12.3-20.85z"/>
    </svg>
  );
}

export default DriveIcon;
