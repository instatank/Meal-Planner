const fs = require('fs');
const content = fs.readFileSync('src/App.jsx', 'utf8');

// The three blocks to grab and rearrange
const block1Regex = /<div className="flex gap-2 mb-4">[\s\S]*?<\/div>\s*\{\/\* Calendar strip moved to weekly view \*\/\}/;
const block2Regex = /<button[\s\S]*?onClick=\{\(\) => setShowProgress\(!showProgress\)\}[\s\S]*?<\/button>\s*\{showProgress && \([\s\S]*?\}\)\s*\}/;
const block3Regex = /<button[\s\S]*?onClick=\{\(\) => setShowWeekly\(!showWeekly\)\}[\s\S]*?<\/button>\s*\{showWeekly && \([\s\S]*?\}\)\s*\}/;

const b1Match = content.match(block1Regex);
const b2Match = content.match(block2Regex);
const b3Match = content.match(block3Regex);

if (!b1Match || !b2Match || !b3Match) {
  console.error('Failed to match blocks');
  process.exit(1);
}

let b1 = b1Match[0];
let b2 = b2Match[0];
let b3 = b3Match[0];

// Update colors in b1
b1 = b1.replace('bg-green-500', 'bg-orange-500').replace('hover:bg-green-600', 'hover:bg-orange-600');
b1 = b1.replace('bg-gray-200 text-gray-700', 'bg-yellow-500 text-white').replace('hover:bg-gray-300', 'hover:bg-yellow-600');

// Update labels in b3
b3 = b3.replace(/Weekly Calendar/g, "This Week's Plan");

// Replace the combined entire section
const oldFullSection = content.substring(content.indexOf(b1), content.indexOf(b3) + b3.length);
const newFullSection = b3 + '\n\n' + b2 + '\n\n' + b1;

const newContent = content.replace(oldFullSection, newFullSection);
fs.writeFileSync('src/App.jsx', newContent);
console.log('Successfully reordered blocks');
