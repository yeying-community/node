set -x

rm -rf dist
rm -rf node_modules

npm install
npm run build
npm run dev

set +x