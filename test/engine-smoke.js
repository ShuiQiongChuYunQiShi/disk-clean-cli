const { run } = require('D:/deepseekHerness/disk-clean-cli/lib/engine.js');
(async () => {
  const scan = await run(['--roots', 'D:/deepseekHerness/windowsClear/.dsk-test', '--suggest']);
  console.log('summary keys:', Object.keys(scan.data.summary || {}));
  console.log('summary:', JSON.stringify(scan.data.summary));
  console.log('suggestions:', scan.data.suggestions.length);
})();
