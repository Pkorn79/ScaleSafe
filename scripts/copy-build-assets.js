const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing build asset source: ${path.relative(root, src)}`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

copyDir(path.join(root, 'src', 'ui', 'dist'), path.join(root, 'dist', 'ui', 'dist'));
copyDir(path.join(root, 'src', 'widgets'), path.join(root, 'dist', 'widgets'));

console.log('Copied UI and widget assets into dist.');
