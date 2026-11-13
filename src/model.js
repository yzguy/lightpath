// Node entry for the topology model (tests, scripts). The model itself is src/model/*.js: consecutive parts of one closure, joined in
// file-name order, exactly as build.sh joins them for the page. Here they run with PHY in scope and the result is the same MODEL object.
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, 'model');
const code = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
const run = vm.runInThisContext(`(function (PHY, require, module) {\n${code}\nreturn MODEL;\n})`, { filename: path.join(dir, 'joined.js') });
module.exports = run(require('./engine.js'), require, { exports: {} });
