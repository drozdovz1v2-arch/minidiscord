const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = process.cwd();
const pkgPath = path.join(root, 'package.json');

if (!fs.existsSync(pkgPath)) {
  console.error('Не найден package.json');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

function run(cmd, options = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, {
    stdio: 'inherit',
    cwd: root,
    shell: true,
    ...options
  });
}

function runQuiet(cmd) {
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: true
    }).trim();
  } catch {
    return '';
  }
}

function fail(msg) {
  console.error(`\nОшибка: ${msg}`);
  process.exit(1);
}

if (!process.env.GH_TOKEN) {
  fail('Не задан GH_TOKEN. Задай его через [Environment]::SetEnvironmentVariable(...) или $env:GH_TOKEN="..."');
}

const gitVersion = runQuiet('git --version');
if (!gitVersion) {
  fail('Git не найден в PATH');
}

const remoteUrl = runQuiet('git remote get-url origin');
if (!remoteUrl) {
  fail('Не настроен remote origin');
}

const currentBranch = runQuiet('git branch --show-current') || 'main';
if (currentBranch !== 'main') {
  console.log(`Текущая ветка: ${currentBranch}`);
}

const tagExists = !!runQuiet(`git rev-parse "${tag}"`);
if (tagExists) {
  fail(`Тег ${tag} уже существует. Подними version в package.json`);
}

run('git add .');

try {
  run(`git commit -m "release ${version}"`);
} catch {
  console.log('\nНет новых изменений для commit, продолжаю...');
}

run(`git tag ${tag}`);
run('git push origin main --tags');
run('npx electron-builder --win nsis --publish always');

console.log(`\nГотово. Релиз ${tag} опубликован.`);
console.log(`Проверь: https://github.com/${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}/releases/tag/${tag}`);