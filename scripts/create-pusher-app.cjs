#!/usr/bin/env node

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.NODE_BASE_URL || 'http://localhost:8100',
    token: process.env.NODE_ADMIN_TOKEN || '',
    appId: '',
    channelPatterns: [],
    allowedOrigins: [],
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--base-url') options.baseUrl = argv[++index] || '';
    else if (token === '--token') options.token = argv[++index] || '';
    else if (token === '--app-id') options.appId = argv[++index] || '';
    else if (token === '--channel-pattern') options.channelPatterns.push(argv[++index] || '');
    else if (token === '--origin') options.allowedOrigins.push(argv[++index] || '');
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.appId) {
    process.stdout.write([
      'Usage:',
      '  NODE_ADMIN_TOKEN=<token> node scripts/create-pusher-app.cjs --app-id project --channel-pattern public-* --channel-pattern private-user.* --channel-pattern private-project.*',
      '',
      'Options:',
      '  --base-url <url>          Node base URL, default NODE_BASE_URL or http://localhost:8100',
      '  --token <token>           Admin JWT/UCAN, default NODE_ADMIN_TOKEN',
      '  --app-id <id>             Pusher app id',
      '  --channel-pattern <glob>  Allowed channel glob, repeatable',
      '  --origin <origin>         Allowed origin, repeatable',
      '',
    ].join('\n'));
    return;
  }
  if (!options.token) {
    throw new Error('Admin token is required. Set NODE_ADMIN_TOKEN or pass --token.');
  }

  const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/api/v1/admin/pusher/apps`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      appId: options.appId,
      channelPatterns: options.channelPatterns.filter(Boolean),
      allowedOrigins: options.allowedOrigins.filter(Boolean),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.message || `Create pusher app failed with HTTP ${response.status}`);
  }
  process.stdout.write(`${JSON.stringify(payload.data, null, 2)}\n`);
}

run().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
