const fs = require('fs');

const content = fs.readFileSync('frontend/app.js', 'utf8');

const startMarker = "    // --- MODULE: FORUM ---";
const endMarker = "    // --- SKUFIA-NET CHAT HUB ---";

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
    console.error('Markers not found!');
    process.exit(1);
}

const featuresContent = content.substring(startIndex, endIndex);
let newAppContent = content.substring(0, startIndex) + content.substring(endIndex);

fs.writeFileSync('frontend/features.js', featuresContent, 'utf8');
fs.writeFileSync('frontend/app.js', newAppContent, 'utf8');
console.log('Successfully extracted features.js!');
