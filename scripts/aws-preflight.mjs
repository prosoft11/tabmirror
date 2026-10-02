import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const settings = JSON.parse(
  readFileSync('infra/production-settings.json', 'utf8'),
);
if (
  settings.accountId !== '400745793130' ||
  settings.profile !== 'default' ||
  settings.region !== 'us-west-2' ||
  settings.certificateRegion !== 'us-east-1'
)
  throw Error('Target configuration mismatch');
function aws(args, region = settings.region) {
  return JSON.parse(
    execFileSync(
      'aws',
      [
        ...args,
        '--profile',
        'default',
        '--region',
        region,
        '--output',
        'json',
        '--no-cli-pager',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
}
try {
  const identity = aws(['sts', 'get-caller-identity']);
  if (identity.Account !== settings.accountId)
    throw Error('AWS account mismatch; stopped');
  console.log(
    `Verified AWS account ${identity.Account}; default profile; primary region ${settings.region}.`,
  );
  for (const region of [settings.region, settings.certificateRegion]) {
    const result = aws(
      [
        'cloudformation',
        'list-stacks',
        '--query',
        "StackSummaries[?starts_with(StackName, 'TabMirror') || StackName == 'CDKToolkit'].{Name:StackName,Status:StackStatus}",
      ],
      region,
    );
    console.log(JSON.stringify({ region, stacks: result }));
  }
  console.log(
    'Read-only preflight complete. Deployment permissions, costs and change sets require review before apply.',
  );
} catch (error) {
  // Do not emit CLI stderr or arbitrary SDK objects; these can contain configuration details.
  console.error(
    error instanceof Error && error.message === 'AWS account mismatch; stopped'
      ? error.message
      : 'AWS preflight failed. No resources changed. Check the default profile and read permissions locally.',
  );
  process.exitCode = 1;
}
